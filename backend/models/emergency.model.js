const mongoose = require('mongoose');

const emergencySchema = new mongoose.Schema({
  emergency_id: { type: String, required: true, unique: true },
  user_name: { type: String, required: true },
  mobile_number: { type: String, required: true },
  location: {
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    accuracy: Number
  },
  address: String,
  emergency_type: { 
    type: String, 
    required: true,
    enum: ['medical', 'police', 'fire', 'accident', 'other']
  },
  description: String,
  severity: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'resolved', 'cancelled'],
    default: 'pending'
  },
  department: {
    type: String,
    enum: ['police', 'medical', 'fire', 'multi', 'pending'],
    default: 'pending'
  },
  assigned_units: [{
    unit_type: String,
    unit_id: String,
    assigned_at: { type: Date, default: Date.now }
  }],
  response_time: Number,
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
});

emergencySchema.index({ emergency_id: 1 });
emergencySchema.index({ status: 1 });
emergencySchema.index({ created_at: -1 });
emergencySchema.index({ department: 1 });

module.exports = mongoose.model('Emergency', emergencySchema);
