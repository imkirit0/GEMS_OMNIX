// One 404 for everything: missing, out of scope and forbidden look identical (no existence oracle, T-SEC-001).
export default function NotFound() {
  return (
    <main>
      <h1>Not found</h1>
      <p><a href="/">Home</a></p>
    </main>
  );
}
