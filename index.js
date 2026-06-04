const mqtt = require('mqtt');
const { Client } = require('pg');
const dns = require('dns');
require('dotenv').config();

// Force IPv4 resolution to prevent ENETUNREACH errors on Render/Supabase
dns.setDefaultResultOrder('ipv4first');

// Configurations from environment variables (Set these in Render Dashboard)
const MQTT_URL = `mqtts://${process.env.MQTT_USER}:${process.env.MQTT_PASS}@${process.env.MQTT_HOST}:8883`;
const PG_CONNECTION_STRING = process.env.SUPABASE_DB_URL ? process.env.SUPABASE_DB_URL.trim() : null;

if (!PG_CONNECTION_STRING) {
    console.error("❌ ERROR: SUPABASE_DB_URL environment variable is not defined!");
    process.exit(1);
}

// Setup Postgres Client
let pgClient;
try {
    pgClient = new Client({ connectionString: PG_CONNECTION_STRING, ssl: { rejectUnauthorized: false } });
} catch (err) {
    console.error("❌ ERROR: The SUPABASE_DB_URL provided is not a valid URL.");
    console.error("Check for special characters in your password that might need encoding.");
    console.error("Expected format: postgresql://postgres:your_password@db.your_id.supabase.co:5432/postgres");
    process.exit(1);
}
pgClient.connect().then(() => console.log("Connected to Supabase DB")).catch(err => console.error(err));

// Setup MQTT Client
const mqttClient = mqtt.connect(MQTT_URL, {
    keepalive: 60,
    reconnectPeriod: 1000,
});

mqttClient.on('connect', () => {
    console.log("✅ Connected to HiveMQ Cloud");
    mqttClient.subscribe("incubator/+/telemetry"); // Wildcard to catch incubator/1/telemetry
});

mqttClient.on('error', (err) => {
    console.error("❌ MQTT Error:", err);
});

mqttClient.on('message', async (topic, message) => {
    try {
        const data = JSON.parse(message.toString());
        console.log("Received Data:", data);

        const query = `
            INSERT INTO incubator_telemetry 
            (device_ts, temperature, humidity, setpoint, room_temp, heater_pwm, pid_mode, uptime, free_heap)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `;
        
        const values = [
            data.ts || Math.floor(Date.now() / 1000), // Fallback to current time if ts is missing
            data.t ?? null, 
            data.h ?? null, 
            data.sp ?? null, 
            data.rt ?? null, 
            data.pwm ?? 0, 
            data.mode ?? 0, 
            data.up ?? 0, 
            data.heap ?? 0
        ];

        await pgClient.query(query, values);
    } catch (err) {
        console.error("Error processing message:", err);
    }
});
