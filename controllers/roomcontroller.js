exports.addRoom = async (req, res, pool) => {
    const requester = req.user;
    if (requester.role !== "admin") {
        return res.status(403).json({ error: "Only admins can add rooms." });
    }

    let { room_number, type, charges_per_day, capacity } = req.body;
    const validTypes = ['Normal', 'ICU', 'General'];

    // Validate required fields
    if (!room_number || !type || !charges_per_day || !validTypes.includes(type)) {
        return res.status(400).json({ error: "Invalid or missing room details." });
    }

    // Validate charges_per_day to be a positive number
    if (isNaN(charges_per_day) || charges_per_day <= 0) {
        return res.status(400).json({ error: "Charges per day must be a positive number." });
    }

    let occupied_strength = null;

    // Handle General room type logic
    if (type === 'General') {
        if (capacity == null || isNaN(capacity)) {
            return res.status(400).json({ error: "Capacity is required for General rooms." });
        }
        occupied_strength = 0; // default to zero when adding
    } else {
        // For Normal and ICU rooms, capacity should be null
        if (capacity != null) {
            capacity = null;
        }
    }

    try {
        await pool.promise().query(
            `INSERT INTO room (room_number, type, charges_per_day, capacity, occupied_strength)
             VALUES (?, ?, ?, ?, ?)`,
            [room_number, type, charges_per_day, capacity, occupied_strength]
        );
        res.status(201).json({ message: "Room added successfully." });
    } catch (err) {
        console.error("Add room error:", err);
        res.status(500).json({ error: "Internal server error." });
    }
};

exports.updateRoom = async (req, res, pool) => {
    const requester = req.user;
    const isAdmin = requester.role === "admin";
    const isFrontdesk = requester.role === "frontdesk";

    // Ensure only admins or frontdesk staff can update rooms
    if (!isAdmin && !isFrontdesk) {
        return res.status(403).json({ error: "Only admins or frontdesk staff can update rooms." });
    }

    const { room_id } = req.params;
    const { room_number, type, status, charges_per_day, capacity } = req.body;
    console.log(req.body);

    // Valid room types and statuses
    const validTypes = ['Normal', 'ICU', 'General'];
    const validStatus = ['Available', 'Occupied', 'Partially Occupied'];

    // Check for valid room type and status
    if (type && !validTypes.includes(type)) {
        return res.status(400).json({ error: "Invalid room type." });
    }

    if (status && !validStatus.includes(status)) {
        return res.status(400).json({ error: "Invalid room status." });
    }

    try {
        if (isAdmin) {
            // Fetch existing room info
            const [roomData] = await pool.promise().query(
                `SELECT status, type FROM room WHERE room_id = ?`,
                [room_id]
            );

            if (roomData.length === 0) {
                return res.status(404).json({ error: "Room not found." });
            }

            const existingRoom = roomData[0];

            if (existingRoom.status === 'Occupied') {
                return res.status(400).json({ error: "Cannot update an occupied room." });
            }

            let finalStatus = status || existingRoom.status;
            let finalCapacity = capacity;

            // Handle type transitions
            if (type === 'General') {
                if (finalCapacity == null || isNaN(finalCapacity)) {
                    return res.status(400).json({ error: "Capacity is required for General rooms." });
                }

                if (!status) {
                    finalStatus = 'Available'; // Default if not provided
                }
            } else if (type === 'Normal' || type === 'ICU') {
                // If changing from General to Normal/ICU, capacity must be null
                finalCapacity = null;
            }

            // Update the room
            await pool.promise().query(
                `UPDATE room 
                 SET room_number = ?, type = ?, status = ?, charges_per_day = ?, capacity = ?
                 WHERE room_id = ?`,
                [room_number, type, finalStatus, charges_per_day, finalCapacity, room_id]
            );
        } else if (isFrontdesk) {
            // Frontdesk staff can only update room status
            if (!status) {
                return res.status(400).json({ error: "Frontdesk can only update room status." });
            }

            // Check if room is occupied
            const [room] = await pool.promise().query(
                `SELECT status FROM room WHERE room_id = ?`,
                [room_id]
            );

            if (room.length === 0) {
                return res.status(404).json({ error: "Room not found." });
            }

            if (room[0].status === 'Occupied') {
                return res.status(400).json({ error: "Cannot update an occupied room." });
            }

            // Update only the status field
            await pool.promise().query(
                `UPDATE room SET status = ? WHERE room_id = ?`,
                [status, room_id]
            );
        }

        res.json({ message: "Room updated successfully." });
    } catch (err) {
        console.error("Update room error:", err);
        res.status(500).json({ error: "Internal server error." });
    }
};

exports.getAvailableRooms = async (req, res, pool) => {
    try {
        // Query rooms that are either 'Available' or 'Partially Occupied' (only for General rooms)
        // Exclude Normal rooms from "Partially Occupied" status and ICU rooms from it as well
        const [rows] = await pool.promise().query(
            `SELECT room_id, room_number, type, status, charges_per_day, capacity, occupied_strength 
             FROM room WHERE status IN ('Available', 'Partially Occupied')`
        );

        // Initialize a result object to group rooms by type
        const groupedRooms = {
            Normal: [],
            ICU: [],
            General: []
        };

        // Process rows to add remaining capacity for partially occupied rooms
        rows.forEach(room => {
            // For General rooms, calculate remaining capacity if partially occupied
            if (room.type === 'General' && room.status === 'Partially Occupied') {
                room.remaining_capacity = room.capacity - room.occupied_strength;
            }

            // Exclude capacity and remaining_capacity for Normal rooms
            if (room.type === 'Normal') {
                delete room.capacity;
                delete room.remaining_capacity;
            } else if (room.type === 'ICU') {
                delete room.remaining_capacity; // ICU rooms do not have remaining_capacity field
            }

            // Group rooms by type
            if (groupedRooms[room.type]) {
                groupedRooms[room.type].push(room);
            }
        });

        // Send the grouped rooms as response
        res.json({ available_rooms: groupedRooms });
    } catch (err) {
        console.error("Error fetching available rooms:", err);
        res.status(500).json({ error: "Internal server error." });
    }
};
exports.getAllRooms = async (req, res, pool) => {
    try {
        const [rows] = await pool.promise().query(
            `SELECT * FROM room`
        );
        res.json({ rooms: rows });
    } catch (err) {
        console.error("Error fetching available rooms:", err);
        res.status(500).json({ error: "Internal server error." });
    }
};
exports.deleteRoom = async (req, res, pool) => {
    const requester = req.user;

    // Check if the requester has the "admin" role
    if (requester.role !== "admin") {
        return res.status(403).json({ error: "Only admins can delete rooms." });
    }

    const { room_id } = req.params;

    // Check if room_id is provided
    if (!room_id) {
        return res.status(400).json({ error: "Missing room ID." });
    }

    try {
        // Check if the room exists and is not occupied
        const [roomExists] = await pool.promise().query(
            `SELECT room_id, status FROM room WHERE room_id = ?`,
            [room_id]
        );

        // If room doesn't exist, return a 404 error
        if (roomExists.length === 0) {
            return res.status(404).json({ error: "Room not found." });
        }

        // Check if the room is available before allowing deletion
        const room = roomExists[0];
        if (room.status === 'Occupied' || room.status === 'Partially Occupied') {
            return res.status(400).json({ error: "Cannot delete a room that is occupied or partially occupied." });
        }

        // Proceed with deletion if the room is not occupied
        const [result] = await pool.promise().query(
            `DELETE FROM room WHERE room_id = ?`,
            [room_id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: "Room not found." });
        }

        // Return a success response
        res.status(200).json({ message: "Room deleted successfully." });
    } catch (err) {
        console.error("Delete room error:", err);
        res.status(500).json({ error: "Internal server error." });
    }
};




