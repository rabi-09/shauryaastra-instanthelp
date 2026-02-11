const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
require('dotenv').config();
const Groq = require("groq-sdk");
const connectDB = require('./config/db');


const app = express();
const { Emergency, Admin, EmergencyLog, ResponseUnit } = require('./models');

const server = http.createServer(app);
app.use(cors());
app.use(express.json());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../frontend')));



const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});



app.post("/api/ai", async (req, res) => {
  try {
    const { query, language, location, city } = req.body;

    if (!query) {
      return res.status(400).json({ success: false, message: "Query required" });
    }

    const prompt = createPrompt(query, language, location, city);

    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.4,
    });

    const aiText = completion.choices[0]?.message?.content ||
      "Unable to process emergency request.";

    res.json({
      success: true,
      response: aiText,
    });

  } catch (error) {
    console.error("Groq API Error:", error);
    res.status(500).json({
      success: false,
      message: "AI service error",
    });
  }
});





function createPrompt(userQuery, language, location, city) {
  return `
You are an advanced emergency response assistant.

USER QUERY: "${userQuery}"
USER LANGUAGE: ${language}
USER LOCATION: ${location || "Unknown"}
USER CITY: ${city || "Unknown"}

INSTRUCTIONS:
1. Provide immediate actionable emergency guidance.
2. Respond in ${language === "hi" ? "Hindi" : language === "or" ? "Odia" : "English"}.
3. Mention Indian emergency numbers:
   - Police: 100
   - Ambulance: 108
   - Fire: 101
4. Keep response clear and calm.
5. Do NOT use markdown or special formatting.
`;
}


const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3001;



connectDB();





// Real-time Socket.IO Communication
const activeSirens = new Map();

io.on('connection', (socket) => {
  console.log('🔗 New client connected:', socket.id);

  // User joins their personal room for updates
  socket.on('join-user', (userData) => {
    if (userData.mobile) {
      socket.join(`user-${userData.mobile}`);
      console.log(`User ${userData.mobile} joined their room`);
    }
  });

  // Admin joins admin room
  socket.on('join-admin', (adminId) => {
    socket.join('admin-room');
    socket.adminId = adminId;
    console.log(`Admin ${adminId} joined admin room`);
  });

  // Emergency room for specific emergencies
  socket.on('join-emergency', (emergencyId) => {
    socket.join(`emergency-${emergencyId}`);
    console.log(`Client ${socket.id} joined emergency: ${emergencyId}`);
  });

  // Location updates from users
  socket.on('location-update', (data) => {
    socket.to('admin-room').emit('user-location-update', data);
  });

  // Response unit location updates
  socket.on('response-unit-location', (data) => {
    socket.to('admin-room').emit('response-unit-location', data);
    socket.to(`emergency-${data.emergencyId}`).emit('unit-location-update', data);
  });

  // Emergency status updates
  socket.on('emergency-status-update', (data) => {
    const { emergencyId, status, adminName, notes } = data;

    // Notify admin room
    socket.to('admin-room').emit('emergency-status-changed', data);

    // Notify specific emergency room
    socket.to(`emergency-${emergencyId}`).emit('emergency-status-changed', data);

    // Notify user if they have mobile number
    if (data.userMobile) {
      socket.to(`user-${data.userMobile}`).emit('user-emergency-update', {
        emergencyId,
        status,
        message: `Your emergency status updated to: ${status}`,
        adminName,
        notes,
        timestamp: new Date()
      });
    }
  });

  // Critical emergency siren trigger
  socket.on('trigger-siren', (emergencyData) => {
    console.log('🚨 SIREN TRIGGERED:', emergencyData.emergency_id);

    // Store siren info
    activeSirens.set(emergencyData.emergency_id, {
      emergencyData,
      triggeredAt: new Date(),
      duration: 30000 // 30 seconds
    });

    // Emit to all admins
    io.to('admin-room').emit('emergency-siren', {
      ...emergencyData,
      sirenDuration: 30000,
      triggeredAt: new Date()
    });

    // Auto-stop siren after 30 seconds
    setTimeout(() => {
      if (activeSirens.has(emergencyData.emergency_id)) {
        activeSirens.delete(emergencyData.emergency_id);
        io.to('admin-room').emit('siren-stopped', {
          emergencyId: emergencyData.emergency_id
        });
      }
    }, 30000);
  });

  // Stop siren manually
  socket.on('stop-siren', (emergencyId) => {
    if (activeSirens.has(emergencyId)) {
      activeSirens.delete(emergencyId);
      io.to('admin-room').emit('siren-stopped', { emergencyId });
    }
  });

  // Get active sirens when admin connects
  socket.on('get-active-sirens', () => {
    const sirens = Array.from(activeSirens.values());
    socket.emit('active-sirens', sirens);
  });

  socket.on('disconnect', () => {
    console.log('🔌 Client disconnected:', socket.id);
  });
});

// Create new emergency
app.post('/api/emergency', async (req, res) => {
  try {
    const {
      userName,
      mobileNumber,
      location,
      emergencyType,
      description,
      address,
      severity = 'medium'
    } = req.body;

    // Generate unique emergency ID
    const emergencyId = 'EMG' + Date.now();

    const emergency = new Emergency({
      emergency_id: emergencyId,
      user_name: userName,
      mobile_number: mobileNumber,
      location: location,
      emergency_type: emergencyType,
      description: description,
      address: address,
      severity: severity,
      status: 'pending',
      created_at: new Date(),
      updated_at: new Date()
    });

    await emergency.save();

    // Log the emergency creation
    const log = new EmergencyLog({
      emergency_id: emergencyId,
      action: 'emergency_created',
      department: 'system',
      notes: `New emergency created: ${emergencyType} - ${description}`,
      created_at: new Date()
    });
    await log.save();

    // Prepare emergency data for real-time updates
    const emergencyData = {
      emergency_id: emergencyId,
      user_name: userName,
      mobile_number: mobileNumber,
      emergency_type: emergencyType,
      description: description,
      severity: severity,
      status: 'pending',
      location: location,
      address: address,
      created_at: new Date(),
      department: 'pending'
    };

    // Notify admins
    io.to('admin-room').emit('new-emergency', emergencyData);

    // Trigger siren for critical emergencies
    if (severity === 'critical' ||
      emergencyType === 'medical' ||
      emergencyType === 'accident' ||
      description.toLowerCase().includes('critical') ||
      description.toLowerCase().includes('serious') ||
      description.toLowerCase().includes('heart attack') ||
      description.toLowerCase().includes('unconscious')) {

      io.emit('trigger-siren', {
        ...emergencyData,
        sirenReason: 'CRITICAL_EMERGENCY_DETECTED'
      });
    }

    // Notify user about emergency creation
    io.to(`user-${mobileNumber}`).emit('user-emergency-update', {
      emergencyId: emergencyId,
      status: 'pending',
      message: 'Emergency reported successfully! Help is on the way.',
      timestamp: new Date()
    });

    res.status(201).json({
      success: true,
      message: 'Emergency reported successfully',
      emergency_id: emergencyId,
      data: emergency
    });
  } catch (error) {
    console.error('Error creating emergency:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to report emergency',
      error: error.message
    });
  }
});

// Get all emergencies
app.get('/api/emergencies', async (req, res) => {
  try {
    const emergencies = await Emergency.find().sort({ created_at: -1 });
    res.json({
      success: true,
      data: emergencies
    });
  } catch (error) {
    console.error('Error fetching emergencies:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch emergencies',
      error: error.message
    });
  }
});

// Get emergencies by user mobile
app.get('/api/user/emergencies/:mobile', async (req, res) => {
  try {
    const emergencies = await Emergency.find({
      mobile_number: req.params.mobile
    }).sort({ created_at: -1 });

    res.json({
      success: true,
      data: emergencies
    });
  } catch (error) {
    console.error('Error fetching user emergencies:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user emergencies',
      error: error.message
    });
  }
});

// Get emergency by ID
app.get('/api/emergency/:id', async (req, res) => {
  try {
    const emergency = await Emergency.findOne({ emergency_id: req.params.id });
    if (!emergency) {
      return res.status(404).json({
        success: false,
        message: 'Emergency not found'
      });
    }
    res.json({
      success: true,
      data: emergency
    });
  } catch (error) {
    console.error('Error fetching emergency:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch emergency',
      error: error.message
    });
  }
});

// Update emergency status
app.put('/api/emergency/:id/status', async (req, res) => {
  try {
    const { status, department, notes, admin_name } = req.body;

    const emergency = await Emergency.findOne({ emergency_id: req.params.id });
    if (!emergency) {
      return res.status(404).json({
        success: false,
        message: 'Emergency not found'
      });
    }

    emergency.status = status;
    if (department) emergency.department = department;
    emergency.updated_at = new Date();

    await emergency.save();

    // Log the status update
    const log = new EmergencyLog({
      emergency_id: req.params.id,
      action: 'status_updated',
      department: department || 'system',
      admin_name: admin_name,
      notes: notes || `Status changed to: ${status}`,
      created_at: new Date()
    });
    await log.save();

    // Real-time update
    io.emit('emergency-status-update', {
      emergencyId: req.params.id,
      status: status,
      adminName: admin_name,
      notes: notes,
      userMobile: emergency.mobile_number,
      timestamp: new Date()
    });

    res.json({
      success: true,
      message: 'Emergency status updated successfully',
      data: emergency
    });
  } catch (error) {
    console.error('Error updating emergency:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update emergency',
      error: error.message
    });
  }
});

// Get emergency logs
app.get('/api/emergency/:id/logs', async (req, res) => {
  try {
    const logs = await EmergencyLog.find({ emergency_id: req.params.id }).sort({ created_at: -1 });
    res.json({
      success: true,
      data: logs
    });
  } catch (error) {
    console.error('Error fetching logs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch logs',
      error: error.message
    });
  }
});

// Admin login (optional - kept for future use)
app.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password, department } = req.body;

    const admin = await Admin.findOne({
      username: username,
      department: department
    });

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    if (admin.password !== password) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    res.json({
      success: true,
      message: 'Login successful',
      admin: {
        id: admin._id,
        username: admin.username,
        department: admin.department,
        name: admin.name
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed',
      error: error.message
    });
  }
});

// Get emergencies by department
app.get('/api/emergencies/department/:department', async (req, res) => {
  try {
    const emergencies = await Emergency.find({
      department: req.params.department
    }).sort({ created_at: -1 });

    res.json({
      success: true,
      data: emergencies
    });
  } catch (error) {
    console.error('Error fetching department emergencies:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch emergencies',
      error: error.message
    });
  }
});

// Dashboard stats
app.get('/api/dashboard/stats', async (req, res) => {
  try {
    const totalEmergencies = await Emergency.countDocuments();
    const pendingEmergencies = await Emergency.countDocuments({ status: 'pending' });
    const inProgressEmergencies = await Emergency.countDocuments({ status: 'in_progress' });
    const resolvedEmergencies = await Emergency.countDocuments({ status: 'resolved' });

    const emergenciesByType = await Emergency.aggregate([
      {
        $group: {
          _id: '$emergency_type',
          count: { $sum: 1 }
        }
      }
    ]);

    const emergenciesByHour = await Emergency.aggregate([
      {
        $group: {
          _id: { $hour: '$created_at' },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);

    res.json({
      success: true,
      data: {
        total: totalEmergencies,
        pending: pendingEmergencies,
        inProgress: inProgressEmergencies,
        resolved: resolvedEmergencies,
        byType: emergenciesByType,
        byHour: emergenciesByHour
      }
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard stats',
      error: error.message
    });
  }
});

// Analytics data
app.get('/api/analytics/emergencies', async (req, res) => {
  try {
    const period = req.query.period || '7d';

    const byType = await Emergency.aggregate([
      {
        $group: {
          _id: '$emergency_type',
          count: { $sum: 1 }
        }
      }
    ]);

    const byHour = await Emergency.aggregate([
      {
        $group: {
          _id: { $hour: '$created_at' },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);

    const byStatus = await Emergency.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        byType,
        byHour,
        byStatus
      }
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch analytics',
      error: error.message
    });
  }
});

// Response units endpoints
app.get('/api/response-units', async (req, res) => {
  try {
    const units = await ResponseUnit.find();
    res.json({
      success: true,
      data: units
    });
  } catch (error) {
    console.error('Error fetching response units:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch response units',
      error: error.message
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
    timestamp: new Date(),
    uptime: process.uptime(),
    activeSirens: activeSirens.size
  });
});

// Serve admin dashboard
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend', 'admin.html'));
});


app.get('/track', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend', 'track.html'));
});



app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend', 'home.html'));
});

app.get('/help', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend', 'instant_help.html'));
});
// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found'
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Main App: http://localhost:${PORT}`);
  console.log(`👨‍💼 Admin Dashboard: http://localhost:${PORT}/admin`);
  console.log(`🚨 Siren System: ACTIVE`);
});