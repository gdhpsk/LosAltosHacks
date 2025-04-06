const mongoose = require("mongoose")
const { decryptData } = require("../encrypt")

const schema = new mongoose.Schema({
    key: {
        type: String,
        required: true
    },
    location: {
        type: String,
        required: true,
        validate: {
            validator: async function(v) {
                try {
                    let location = await decryptData(v)
                    let coordinates = JSON.parse(location)
                    if(coordinates.longitude > 180 || coordinates.longitude < -180) return false
                    if(coordinates.latitude > 90 || coordinates.latitude < -90) return false
                    return v
                } catch(_) {
                    return false
                }
            }
        }
    }
})
module.exports = mongoose.model("reporter", schema)