// No generic upstream proxy, credential relay or mutation surface in M2.
import { NextResponse } from "next/server";
function disabled() {
  return NextResponse.json({ error: "API surfaces disabled in M2" }, { status: 503 });
}
export { disabled as GET, disabled as POST, disabled as PUT, disabled as PATCH, disabled as DELETE, disabled as OPTIONS, disabled as HEAD };
