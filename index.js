const mqtt = require('mqtt');
const { Client } = require('pg');
require('dotenv').config();

// Configurations from environment variables (Set these in Render Dashboard)
const MQTT_URL = `mqtts://${process.env.MQTT_USER}:${process.env.MQTT_PASS}@${process.env.MQTT_HOST}:8883`;
const PG_CONNECTION_STRING = process.env.SUPABASE_DB_URL;

// Setup Postgres Client
const pgClient = new Client({ connectionString: PG_CONNECTION_STRING });
pgClient.connect().then(() => console.log("Connected to Supabase DB")).catch(err => console.error(err));

// Setup MQTT Client
const mqttClient = mqtt.connect(MQTT_URL, {
    keepalive: 60,
    reconnectPeriod: 1000,
});

mqttClient.on('connect', () => {
    console.log("✅ Connected to HiveMQ Cloud");
    mqttClient.subscribe("incubator/telemetry"); // Ensure this matches your ESP32 topic
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
            data.ts, 
            data.t, 
            data.h, 
            data.sp, 
            data.rt, 
            data.pwm, 
            data.mode, 
            data.up, 
            data.heap
        ];

        await pgClient.query(query, values);
    } catch (err) {
        console.error("Error processing message:", err);
    }
});
