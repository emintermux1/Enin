import { adminSnapshot } from "../../lib/store";

export default function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ k?: string }>;
}) {
  return <AdminGate searchParams={searchParams} />;
}

async function AdminGate({ searchParams }: { searchParams: Promise<{ k?: string }> }) {
  const { k } = await searchParams;
  const secret = process.env.ADMIN_SECRET ?? "";
  if (!secret || k !== secret) {
    return (
      <main style={{ padding: 48, fontFamily: "monospace" }}>
        <p>Not found.</p>
      </main>
    );
  }
  const snap = adminSnapshot();
  return (
    <main style={{ padding: 40, fontFamily: "monospace", color: "#f3e6d2", background: "#1a1410", minHeight: "100vh" }}>
      <h1>VICEBLOCK OPS</h1>
      <p>Players {snap.players}</p>
      <p>Sessions {snap.sessions}</p>
      <p>Cash in world ${snap.cash}</p>
      <p>Drop rates and bans are unfinished — do not expose this URL.</p>
    </main>
  );
}
