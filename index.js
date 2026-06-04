const mqtt = require('mqtt');
const { Pool } = require('pg');
const http = require('http');
const dns = require('dns');
require('dotenv').config();

// Force IPv4 resolution to prevent ENETUNREACH errors on Render/Supabase
dns.setDefaultResultOrder('ipv4first');

// Configurations from environment variables (Set these in Render Dashboard)
const MQTT_URL = `mqtts://${process.env.MQTT_USER}:${process.env.MQTT_PASS}@${process.env.MQTT_HOST}:8883`;
const PG_CONNECTION_STRING = process.env.SUPABASE_DB_URL ? process.env.SUPABASE_DB_URL.trim() : null;

// Dummy HTTP Server to satisfy Render's health check
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('HiveMQ-Supabase Bridge is running\n');
}).listen(PORT, () => {
    console.log(` Health check server listening on port ${PORT}`);
});

if (!PG_CONNECTION_STRING) {
    console.error("❌ ERROR: SUPABASE_DB_URL environment variable is not defined!");
    process.exit(1);
}

// Debug: Log connection attempt (hiding password)
const connectionLog = PG_CONNECTION_STRING.replace(/:([^:@]+)@/, ':****@');
console.log(`🔌 Initializing connection pool to: ${connectionLog}`);

// Setup Postgres Pool (Highly recommended for long-running cloud services)
const pool = new Pool({ 
    connectionString: PG_CONNECTION_STRING, 
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000, // Don't hang forever
    idleTimeoutMillis: 30000
});

pool.on('error', (err) => {
    console.error('❌ Unexpected error on idle database client', err);
});

// Setup MQTT Client
const mqttClient = mqtt.connect(MQTT_URL, {
    keepalive: 60,
    reconnectPeriod: 1000,
});

mqttClient.on('connect', () => {
    console.log("✅ Connected to HiveMQ Cloud");
    // Optimized topic list to reduce overhead
    const topics = [
        "incubator/#",     
        "Incubator/#",     
        "incubator/telemetry",
        "#"                // Temporary broad subscription for debugging
    ];
    mqttClient.subscribe(topics, () => {
        console.log(`📡 Subscribed to topics: ${topics.join(", ")}`);
    });
});

mqttClient.on('error', (err) => {
    console.error("❌ MQTT Error:", err);
});

mqttClient.on('message', async (topic, message) => {
    console.log(`📩 Raw message received on [${topic}]: ${message.toString()}`);
    try {
        const data = JSON.parse(message.toString());
        console.log(`📥 Parsed Data:`, JSON.stringify(data));

        const query = `
            INSERT INTO incubator_telemetry 
            (device_ts, temperature, humidity, setpoint, room_temp, heater_pwm, pid_mode, uptime, free_heap)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `;
        
        // Ensure numeric types are actually numbers and handle potential strings from MQTT
        const toNum = (val) => (val !== null && val !== undefined ? Number(val) : null);

        const values = [
            data.ts || Math.floor(Date.now() / 1000), // Fallback to current time if ts is missing
            toNum(data.t), 
            toNum(data.h), 
            toNum(data.sp), 
            toNum(data.rt), 
            toNum(data.pwm) || 0, 
            toNum(data.mode) || 0, 
            toNum(data.up) || 0, 
            toNum(data.heap) || 0
        ];

        console.log("📤 Attempting to insert into Supabase...");
        await pool.query(query, values);
        console.log("✅ Data successfully saved to database.");
    } catch (err) {
        console.error("❌ Error processing or inserting message:", err.message);
    }
});
