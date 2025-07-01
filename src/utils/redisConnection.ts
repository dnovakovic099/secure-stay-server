import { Redis } from "ioredis";

const connection = new Redis({
    host: '127.0.0.1',
    port: 6379,
    // password: 'your-password-if-any'
    maxRetriesPerRequest: null, 
});

export default connection;
