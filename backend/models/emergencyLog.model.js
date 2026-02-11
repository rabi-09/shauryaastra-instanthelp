const mongoose = require('mongoose');

const emergencyLogSchema = new mongoose.Schema({
  emergency_id: { type: String, required: true },
  action: { 
    type: String, 
    required: true,
    enum: [
      'emergency_created', 
      'status_updated', 
      'department_assigned', 
      'unit_dispatched', 
      'response_completed'
    ]
  },
  department: String,
  admin_name: String,
  notes: String,
  created_at: { type: Date, default: Date.now }
});

emergencyLogSchema.index({ emergency_id: 1 });
emergencyLogSchema.index({ created_at: -1 });

module.exports = mongoose.model('EmergencyLog', emergencyLogSchema);
