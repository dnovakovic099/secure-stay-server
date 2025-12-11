module.exports = {
    apps: [
        {
            name: "secure_stay_api",
            script: "dist/out-tsc/app.js",
            instances: "max",
            exec_mode: "cluster",
            node_args: "--max-old-space-size=1024",
            env: {
                NODE_ENV: "production"
            },
            max_memory_restart: "900M",
            autorestart: true
        }
    ]
};
