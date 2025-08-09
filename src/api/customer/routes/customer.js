module.exports = {
    routes: [
        {
            method: 'POST',
            path: '/customers/sync',
            handler: 'customer.sync',
            config: { auth: false }
        }
    ]
};
