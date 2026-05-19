import { redirect } from "next/navigation";

// /admin lands on the daily command center by default.
export default function AdminIndex() {
  redirect("/admin/today");
}
