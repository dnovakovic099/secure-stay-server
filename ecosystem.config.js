module.exports = {
    apps: [
        {
            name: "secure_stay_api",
            script: "dist/out-tsc/app.js",
            instances: 4,
            exec_mode: "cluster",
            node_args: "--max-old-space-size=768",
            env: {
                NODE_ENV: "production"
            },
            max_memory_restart: "1200M",
            autorestart: true
        },
        {
            name: "hostaway-worker",
            script: "dist/out-tsc/worker/haWorker.js",
            exec_mode: "fork",
            node_args: "--max-old-space-size=512",
            max_memory_restart: "500M",
            autorestart: true,
            env: {
                NODE_ENV: "production"
            }
        }
    ]
};
