module.exports = {
    async sync(ctx) {
        const { clerkId, email, firstName, lastName, imageUrl } = ctx.request.body;

        let user = await strapi.db.query('api::customer.customer').findOne({
            where: { clerkId }
        });

        if (!user) {
            user = await strapi.db.query('api::customer.customer').create({
                data: { clerkId, email, firstName, lastName, imageUrl }
            });
        }

        return user;
    }
};
