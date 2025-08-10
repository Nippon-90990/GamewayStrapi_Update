module.exports = {
    routes: [
        {
            method: "POST",
            path: "/clerk-sync",
            handler: "clerk-sync.handle",
            config: {
                auth: false, // public endpoint; we verify with the Clerk signature
            },
        },
    ],
};
