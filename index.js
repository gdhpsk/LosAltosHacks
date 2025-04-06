const express = require("express")
const locationSchema = require("./schemas/location")
const reporterSchema = require("./schemas/reporter")
const keysSchema = require("./schemas/keys")
const mongoose = require("mongoose")
const { encryptData, decryptData } = require("./encrypt")
const http = require("http")
const ws = require("ws")
const { randomUUID } = require("crypto")
const bcrypt = require("bcrypt")
const cors = require("cors")
mongoose.connect(process.env.MONGODB_URI, {
    dbName: "help",
    readPreference: "nearest",
    authSource: "$external",
    authMechanism: "MONGODB-X509",
    tlsCertificateKeyFile: "./keys/mongo.pem"
})
const app = express()
const server = http.createServer(app)
const wss = new ws.Server({ server })

wss.on("connection", (socket) => {
    // console.log("Client")
    socket.on("message", async (m) => {
        try {
            let message = m.toString()
            console.log(message)
            let json = JSON.parse(message)
            console.log(json)
            if (json.coordinates) {
                socket.coordinates = json.coordinates
                // console.log(json)
                let reports = await locationSchema.find({ active: true })
                reports.forEach(async e => {
                    let location = JSON.parse(await decryptData(e.location))
                    let within = isWithinRadius(json.latitude, json.longitude, location.latitude, location.longitude, process.env.radius)
                    if (within) {
                        socket.send(JSON.stringify({ disaster: e.disaster, id: e._id.toString() }))
                    }
                })
            } else if (json.reporter) {
                let reporters = await reporterSchema.find().lean()
                let reporter = reporters.find((e) => bcrypt.compareSync(json.reporter, e.key))
                if (!reporter) return;
                let location = JSON.parse(await decryptData(reporter.location))
                socket.reporter = {
                    id: reporter._id,
                    coordinates: location
                }
                // console.log(socket.reporter)
            } else if (json.report) {
                if (!socket.reporter) return;
                if (json.report.status == "approved") {
                    socket.chat = json.report.id.toString()
                    wss.clients.forEach(s => {
                        let report_cords = json.report.coordinates
                        let user_cords = s.coordinates
                        // console.log(user_cords)
                        if (!user_cords) return;
                        let within = isWithinRadius(report_cords.latitude, report_cords.longitude, user_cords.latitude, user_cords.longitude, process.env.radius)
                        if (within) {
                            s.send(`disaster_${json.report.disaster}_${json.report.id.toString()}`)
                        }
                    })
                }
            } else if (json.chat) {
                let exists = await locationSchema.exists(json.chat)
                if (!exists) return;
                socket.chat = json.chat
            } else if (json.chat_message) {
                let exists = await locationSchema.exists(socket.chat)
                if (!exists) {
                    socket.chat = undefined
                    return;
                }
                wss.clients.forEach(e => {
                    if (e.chat != socket.chat) return;
                    e.send(JSON.stringify({ chat_message: json.chat_message, reporter: !!socket.reporter }))
                })
            }
        } catch (_) {
            console.log(_)
        }
    })
})

app.use(cors())
app.use(express.static("frontend"))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

function toRadians(degrees) {
    return degrees * (Math.PI / 180);
}

function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 3963.1; // Earth's radius in miles
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    return distance;
}

function isWithinRadius(lat1, lon1, lat2, lon2, radius = 10) {
    const distance = haversineDistance(lat1, lon1, lat2, lon2);
    return distance <= radius;
}

app.post("/api-keys", async (req, res) => {
    if (process.env.MASTER_KEY !== req.body.key) return res.status(401).json({ message: "You're not authorized for this command" })
    let keys = await keysSchema.find().lean()
    let decrypted = await Promise.all(keys.map(async e => {
        e.location = JSON.parse(await decryptData(e.location))
        return e
    }))
    return res.json(decrypted)
})

app.post("/reporters", async (req, res) => {
        if (!req.body.key) return res.status(400).json({ message: "No API Key provided" })
        let key = (await keysSchema.find().lean(true)).find(e => bcrypt.compareSync(req.body.key, e.key))
        if (!key) return res.status(404).json({ message: "Could not find API Key" })
        let keys = await reporterSchema.find({ author: key._id }).lean()
        let decrypted = await Promise.all(keys.map(async e => {
            e.location = JSON.parse(await decryptData(e.location))
            return e
        }))
        return res.json(decrypted)
})

app.post("/api-key", async (req, res) => {
    if (process.env.MASTER_KEY !== req.body.key) return res.status(401).json({ message: "You're not authorized for this command" })
    if ((typeof req.body.longitude !== "number") || (typeof req.body.latitude !== "number")) return res.status(400).json({ message: "please input valid coordinates!" })
    let coordinates = {
        longitude: parseFloat(req.body.longitude),
        latitude: parseFloat(req.body.latitude)
    }
    let key = randomUUID()
    let encrypted_key = await bcrypt.hash(key, 10)
    let encrypted_coordinates = await encryptData(JSON.stringify(coordinates))
    let doc = await keysSchema.create({ key: encrypted_key, location: encrypted_coordinates })
    return res.status(201).json({ _id: doc._id.toString(), key: doc.key, id: key, location: coordinates })
})

app.delete("/api-key", async (req, res) => {
    if (process.env.MASTER_KEY !== req.body.key) return res.status(401).json({ message: "You're not authorized for this command" })
    let author = await keysSchema.findByIdAndDelete(req.body.id)
    await reporterSchema.deleteMany({ author: author._id })
    return res.status(200).json({ id: author._id.toString() })
})

app.delete("/reporter", async (req, res) => {
    if (!req.body.key) return res.status(400).json({ message: "No API Key provided" })
    let key = (await keysSchema.find().lean(true)).find(e => bcrypt.compareSync(req.body.key, e.key))
    if (!key) return res.status(404).json({ message: "Could not find API Key" })
    let id = await reporterSchema.findByIdAndDelete(req.body.id)
    return res.status(200).json({ id: id._id.toString() })
})

app.post("/reporter", async (req, res) => {
    if (!req.body.key) return res.status(400).json({ message: "No API Key provided" })
    if ((typeof req.body.longitude !== "number") || (typeof req.body.latitude !== "number")) return res.status(400).json({ message: "please input valid coordinates!" })
    let key = (await keysSchema.find().lean(true)).find(e => bcrypt.compareSync(req.body.key, e.key))
    if (!key) return res.status(404).json({ message: "Could not find API Key" })
    let key_coordinates = JSON.parse(await decryptData(key.location))
    let reporter_coordinates = {
        longitude: parseFloat(req.body.longitude),
        latitude: parseFloat(req.body.latitude)
    }
    let acceptable = isWithinRadius(key_coordinates.latitude, key_coordinates.longitude, reporter_coordinates.latitude, reporter_coordinates.longitude, process.env.radius)
    if (!acceptable) return res.status(401).json({ message: `You are not within a ${process.env.radius} mile radius of this location` })
    let key_reporter = randomUUID()
    let encrypted_key = await bcrypt.hash(key_reporter, 10)
    let encoded = await encryptData(JSON.stringify(reporter_coordinates))
    let doc = await reporterSchema.create({ location: encoded, key: encrypted_key, author: key._id })
    return res.status(201).json({ _id: doc._id.toString(), key: doc.key.toString(), author: doc.author.toString(), id: key_reporter, location: reporter_coordinates })
})

app.post("/incident/receive", async (req, res) => {
    // console.log("HELLO 2")
    let reporters = await reporterSchema.find().lean()
    let reporter = reporters.find(e => bcrypt.compareSync(req.body.key, e.key))
    if (!reporter) return res.status(401).json({ message: "Not a valid reporter key" })
    reporter.location = JSON.parse(await decryptData(reporter.location))
    let incident = await locationSchema.findById(req.body.id).lean()
    incident.location = JSON.parse(await decryptData(incident.location))
    let allowed = isWithinRadius(reporter.location.latitude, reporter.location.longitude, incident.location.latitude, incident.location.longitude, process.env.radius)
    if (!allowed) return res.status(401).json({ message: "You cannot view this location" })

    return res.json({ _id: incident._id.toString(), location: incident.location, disaster: incident.disaster })
})

app.post("/incidents", async (req, res) => {
    if (process.env.MASTER_KEY !== req.body.key) return res.status(401).json({ message: "You're not authorized for this command" })
    let incident = await locationSchema.find().lean()
    let incidents = await Promise.all(incident.map(async e => {
        e.location = JSON.parse(await decryptData(e.location))
        return e
    }))
    return res.json(incidents)
})

app.delete("/incident", async (req, res) => {
    if (process.env.MASTER_KEY !== req.body.key) {
        let reporters = await reporterSchema.find().lean()
        let reporter = reporters.find(e => bcrypt.compareSync(req.body.key, e.key))
        if (!reporter) return res.status(401).json({ message: "Not a valid reporter key" })
        reporter.location = JSON.parse(await decryptData(reporter.location))
    }
    let incident = await locationSchema.findByIdAndDelete(req.body.id)
    require("./local.json").coordinates = structuredClone(require("./local.json").coordinates.filter(e => e._id.toString() !== req.body.id))
    return res.json({ id: incident._id.toString() })
})

app.post("/incident", async (req, res) => {
    // console.log("HELLO")
    if (!req.body.disaster) return res.status(400).json({ message: "Please input a disaster!" })
    if (!req.body.coordinates) return res.status(400).json({ message: "please input valid coordinates!" })
    let coordinates = {
        longitude: req.body.coordinates[0],
        latitude: req.body.coordinates[1]
    }
    let withinRadius = require("./local.json").coordinates.map(e => isWithinRadius(coordinates.latitude, coordinates.longitude, e.location.latitude, e.location.longitude, process.env.radius)).find(e => e)
    if (withinRadius) return res.status(400).json({ message: "This incident has already been reported." })
    let encoded = await encryptData(JSON.stringify(coordinates))
    let c = await locationSchema.create({ location: encoded, disaster: req.body.disaster, active: true })
    let reporters = []
    wss.clients.forEach(async (e) => {
        // console.log(e.reporter)
        if (!e.reporter) return;
        let withinRadius = isWithinRadius(coordinates.latitude, coordinates.longitude, e.reporter.coordinates.latitude, e.reporter.coordinates.longitude, process.env.radius)
        if (withinRadius) {
            reporters.push(e.reporter.id)
            e.send(`Report: ${c._id.toString()}`)
            return;
        }
    })
    c.reporters = reporters
    c.save()
    require("./local.json").coordinates.push({ location: coordinates, disaster: req.body.disaster, active: true, _id: c._id.toString() })
    return res.status(201).json({ message: "Success" })
});

(async () => {
    let data = await locationSchema.find({ active: true }).lean(true)
    data = await Promise.all(data.map(async (v) => {
        v.location = JSON.parse(await decryptData(v.location))
        v._id = v._id.toString()
        return v
    }))
    require("./local.json").coordinates = data
})().then(() => {
    // setInterval(() => {
    //     console.log(require("./local.json"))
    // }, 5000)
    server.listen(process.env.PORT, () => {
        console.log(`Server running on port ${process.env.PORT}`)
    })
});