const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Store active buses
const activeBuses = new Map(); // busId -> { driverSocketId, busName, routeName, location, students: [] }

// Store student connections per bus
const busStudents = new Map(); // busId -> Set<socketId>

// --- SOCKET.IO ---
io.on('connection', (socket) => {
    console.log(`🔌 Connected: ${socket.id}`);

    // ============ DRIVER EVENTS ============

    // Driver registers a bus
    socket.on('driver:register', (data) => {
        const { busName, routeName, busId } = data;
        const id = busId || uuidv4().slice(0, 8);

        activeBuses.set(id, {
            driverSocketId: socket.id,
            busName: busName || `Bus #${id}`,
            routeName: routeName || 'Main Route',
            location: null,
            heading: 0,
            speed: 0,
            lastUpdate: null,
            students: []
        });

        if (!busStudents.has(id)) {
            busStudents.set(id, new Set());
        }

        socket.join(`bus:${id}`);
        socket.emit('driver:registered', { busId: id, success: true });
        console.log(`🚌 Bus registered: ${id} - ${busName}`);
    });

    // Driver sends location update
    socket.on('driver:updateLocation', (data) => {
        const { busId, lat, lng, heading, speed } = data;

        // Find bus by driver socket ID or busId
        let busEntry = null;
        for (const [id, bus] of activeBuses) {
            if (id === busId || bus.driverSocketId === socket.id) {
                busEntry = { id, bus };
                break;
            }
        }

        if (busEntry) {
            busEntry.bus.location = { lat, lng };
            busEntry.bus.heading = heading || 0;
            busEntry.bus.speed = speed || 0;
            busEntry.bus.lastUpdate = Date.now();

            // Broadcast to all students tracking this bus
            io.to(`bus:${busEntry.id}`).emit('student:locationUpdate', {
                busId: busEntry.id,
                busName: busEntry.bus.busName,
                routeName: busEntry.bus.routeName,
                location: { lat, lng },
                heading: heading || 0,
                speed: speed || 0,
                lastUpdate: Date.now()
            });
        }
    });

    // ============ STUDENT EVENTS ============

    // Student asks for list of active buses
    socket.on('student:getBuses', () => {
        const busList = [];
        for (const [id, bus] of activeBuses) {
            if (bus.location) {
                busList.push({
                    busId: id,
                    busName: bus.busName,
                    routeName: bus.routeName,
                    location: bus.location,
                    lastUpdate: bus.lastUpdate
                });
            }
        }
        socket.emit('student:busList', busList);
    });

    // Student starts tracking a specific bus
    socket.on('student:trackBus', (busId) => {
        const bus = activeBuses.get(busId);
        if (bus) {
            socket.join(`bus:${busId}`);
            if (!busStudents.has(busId)) {
                busStudents.set(busId, new Set());
            }
            busStudents.get(busId).add(socket.id);

            // Send current location immediately
            if (bus.location) {
                socket.emit('student:locationUpdate', {
                    busId,
                    busName: bus.busName,
                    routeName: bus.routeName,
                    location: bus.location,
                    heading: bus.heading,
                    speed: bus.speed,
                    lastUpdate: bus.lastUpdate
                });
            }

            socket.emit('student:trackingStarted', { busId, success: true });
            console.log(`👤 Student ${socket.id} tracking bus ${busId}`);
        } else {
            socket.emit('student:trackingStarted', { busId, success: false, error: 'Bus not found' });
        }
    });

    // Student stops tracking
    socket.on('student:stopTracking', (busId) => {
        socket.leave(`bus:${busId}`);
        if (busStudents.has(busId)) {
            busStudents.get(busId).delete(socket.id);
        }
    });

    // ============ DISCONNECT ============
    socket.on('disconnect', () => {
        console.log(`❌ Disconnected: ${socket.id}`);

        // Check if this socket was a driver
        for (const [id, bus] of activeBuses) {
            if (bus.driverSocketId === socket.id) {
                // Notify students that bus went offline
                io.to(`bus:${id}`).emit('student:busOffline', {
                    busId: id,
                    busName: bus.busName,
                    message: 'Bus driver has disconnected'
                });
                activeBuses.delete(id);
                busStudents.delete(id);
                console.log(`🚌 Bus ${id} went offline`);
                break;
            }
        }

        // Remove from any student tracking sets
        for (const [busId, students] of busStudents) {
            if (students.has(socket.id)) {
                students.delete(socket.id);
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════╗
║     🚌 SCHOOL BUS TRACKER SERVER         ║
║──────────────────────────────────────────║
║  Server running on http://localhost:${PORT}  ║
║                                          ║
║  📱 Driver page: /driver.html           ║
║  👀 Student page: /student.html          ║
╚══════════════════════════════════════════╝
    `);
});