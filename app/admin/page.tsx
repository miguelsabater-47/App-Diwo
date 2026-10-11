import { notFound } from "next/navigation";

/** Fail closed, independently of middleware, until Supabase authorization exists. */
export default function AdminPage() {
  notFound();
}
