"use strict";

const { Webhook } = require("svix");

module.exports = {
    async handle(ctx) {
        try {
            const clerkSecret = process.env.CLERK_WEBHOOK_SECRET;
            if (!clerkSecret) {
                strapi.log.error("CLERK_WEBHOOK_SECRET not configured");
                return ctx.internalServerError("Webhook not configured");
            }

            // 1) Get raw payload for signature verification.
            // Strapi sometimes exposes raw body at ctx.request.rawBody or ctx.request.body.
            // svix verification requires the raw bytes/string exactly as sent by Clerk.
            let rawBody;
            if (ctx.request && ctx.request.rawBody) {
                rawBody = ctx.request.rawBody;
            } else if (ctx.req) {
                // read from the node request stream if available (fallback)
                // NOTE: reading the stream here only when ctx.request.body is empty.
                // Most Strapi installs will have parsed body available; reading stream
                // is rarely necessary but included as fallback.
                rawBody = await new Promise((resolve, reject) => {
                    let data = "";
                    ctx.req.on("data", (chunk) => (data += chunk));
                    ctx.req.on("end", () => resolve(data));
                    ctx.req.on("error", (err) => reject(err));
                });
            } else {
                // last fallback: reconstruct stringified JSON (may fail verification if formatting differs)
                rawBody = JSON.stringify(ctx.request.body || {});
            }

            const svix = new Webhook(clerkSecret);

            let evt;
            try {
                // Pass the raw body string and request headers to svix verify
                evt = svix.verify(rawBody, ctx.request.headers);
            } catch (err) {
                strapi.log.warn("Clerk webhook signature verification failed:", err.message);
                return ctx.badRequest("Invalid webhook signature");
            }

            // evt now is the verified event object
            const eventType = evt.type;
            const user = evt.data;

            if (!user || typeof user !== "object") {
                strapi.log.warn("Clerk webhook missing user data");
                return ctx.badRequest("Invalid payload");
            }

            // Extract fields safely
            const clerkId = user.id;
            const email = user.email_addresses?.[0]?.email_address || null;
            const firstName = user.first_name || "";
            const lastName = user.last_name || "";
            const username = user.username || `${firstName} ${lastName}`.trim();
            const avatar = user.image_url || null;

            // Sync logic
            if (eventType === "user.created" || eventType === "user.updated") {
                // Try to find existing by clerkId first, if not found fall back to email
                let existing = null;
                if (clerkId) {
                    existing = await strapi.db.query("api::customer.customer").findOne({
                        where: { clerkId },
                    });
                }

                if (!existing && email) {
                    existing = await strapi.db.query("api::customer.customer").findOne({
                        where: { email },
                    });
                }

                const dataToSave = {
                    clerkId: clerkId || undefined,
                    email: email || undefined,
                    firstName,
                    lastName,
                    username,
                    avatar,
                };

                if (existing) {
                    await strapi.db.query("api::customer.customer").update({
                        where: { id: existing.id },
                        data: dataToSave,
                    });
                    strapi.log.info(`Clerk user updated in Strapi (clerkId=${clerkId || "n/a"})`);
                } else {
                    await strapi.db.query("api::customer.customer").create({
                        data: dataToSave,
                    });
                    strapi.log.info(`Clerk user created in Strapi (clerkId=${clerkId || "n/a"})`);
                }
            } else if (eventType === "user.deleted") {
                // Optional: mark as deleted rather than permanently delete
                // Find by clerkId or email
                let existing = null;
                if (clerkId) {
                    existing = await strapi.db.query("api::customer.customer").findOne({
                        where: { clerkId },
                    });
                }
                if (!existing && email) {
                    existing = await strapi.db.query("api::customer.customer").findOne({
                        where: { email },
                    });
                }

                if (existing) {
                    // Soft-delete: set a flag (recommended). If you don't have a field, you can delete.
                    // Example: update deliveryStatus or add "deleted" boolean in model.
                    // For now we'll just log and (optionally) delete:
                    // await strapi.db.query("api::customer.customer").delete({ where: { id: existing.id } });
                    strapi.log.info(`Clerk user deleted event received for clerkId=${clerkId}, skipping actual delete`);
                }
            } else {
                // ignore other events
                strapi.log.debug(`Clerk webhook received unsupported event type: ${eventType}`);
            }

            ctx.send({ ok: true });
        } catch (err) {
            strapi.log.error("Clerk webhook handler error:", err);
            ctx.internalServerError("Webhook handler error");
        }
    },
};
