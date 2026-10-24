import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/libsql";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import * as authSchema from "@/db/auth-schema";
import { client } from "@/lib/database";

const configuredHosts = (process.env.AUTH_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

const database = drizzle(client, { schema: authSchema });

export const auth = betterAuth({
  appName: "IMS TARA MAA Inventory",
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: {
    allowedHosts: [
      "localhost:3000",
      "127.0.0.1:3000",
      "inventory-management-eight-ruby.vercel.app",
      "im.tarafabbs.com",
      ...configuredHosts,
    ],
    protocol: process.env.NODE_ENV === "development" ? "http" : "https",
  },
  database: drizzleAdapter(database, { provider: "sqlite", schema: authSchema }),
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      prompt: "select_account",
    },
  },
  session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
  plugins: [nextCookies()],
});

