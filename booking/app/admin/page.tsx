import { redirect } from "next/navigation";

// /admin lands on the inbox by default — there's no separate dashboard view.
export default function AdminIndex() {
  redirect("/admin/inbox");
}
