const mongoose = require("mongoose")
const { decryptData } = require("../encrypt")

const schema = new mongoose.Schema({
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
    },
    disaster: {
        type: String,
        required: true
    },
    active: {
        type: Boolean,
        required: true,
        default: true
    },
    reporters: [mongoose.SchemaTypes.ObjectId]
})
module.exports = mongoose.model("location", schema)