import { z } from "zod";

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(8).max(128);

export const credentialsSchema = z.object({ email, password });
