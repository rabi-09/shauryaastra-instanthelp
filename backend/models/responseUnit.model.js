const mongoose = require('mongoose');

const responseUnitSchema = new mongoose.Schema({
  unit_id: { type: String, required: true, unique: true },
  unit_type: { 
    type: String, 
    required: true,
    enum: ['police_car', 'ambulance', 'fire_truck', 'rescue_team']
  },
  department: { 
    type: String, 
    required: true,
    enum: ['police', 'medical', 'fire']
  },
  unit_name: String,
  current_location: {
    latitude: Number,
    longitude: Number
  },
  status: {
    type: String,
    enum: ['available', 'dispatched', 'busy', 'offline'],
    default: 'available'
  },
  assigned_emergency: String,
  last_updated: { type: Date, default: Date.now }
});

responseUnitSchema.index({ unit_id: 1 });
responseUnitSchema.index({ status: 1 });
responseUnitSchema.index({ department: 1 });

module.exports = mongoose.model('ResponseUnit', responseUnitSchema);
