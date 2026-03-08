import { Schema, model } from 'mongoose'

const lawyerSchema = new Schema({
  name: {
    type: String,
    required: true
  },
  specialty: {
    type: String,
    required: true
  },
  location: {
    city: String,
    state: String
  },
  phone: String,
  email: {
    type: String,
    required: true,
    unique: true
  },
  expertise: [String],
  responseTime: String,
  rate: String,
  feeType: {
    type: String,
    enum: ['hourly', 'contingency', 'flat'],
    default: 'hourly'
  },
  rating: {
    type: Number,
    min: 0,
    max: 5,
    default: 0
  },
  reviewsCount: {
    type: Number,
    default: 0
  },
  verified: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
})

export default model('Lawyer', lawyerSchema)