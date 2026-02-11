const mongoose = require('mongoose');

const adminSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name: { type: String, required: true },
  department: { 
    type: String, 
    required: true,
    enum: ['police', 'medical', 'fire', 'superadmin']
  },
  phone: String,
  email: String,
  is_active: { type: Boolean, default: true },
  created_at: { type: Date, default: Date.now }
});

adminSchema.index({ username: 1 });
adminSchema.index({ department: 1 });

module.exports = mongoose.model('Admin', adminSchema);
