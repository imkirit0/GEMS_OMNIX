import { notFound } from "next/navigation";
import { pageRead } from "@/server/page-read";
import { getCentre } from "@/server/centres";

// Centre view (FR-022.02). Missing, out-of-scope and forbidden all render the same 404 (T-SEC-001).
export default async function CentreView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,9}$/.test(id)) notFound();
  const centre = await pageRead((s) => getCentre(s, Number(id)));
  if (!centre) notFound();
  return (
    <main>
      <p><a href="/centres">All centres</a></p>
      <h1>{centre.code}: {centre.name}</h1>
      <dl>
        <dt>Area</dt><dd>{centre.area}</dd>
        <dt>Region</dt><dd>{centre.region}</dd>
        <dt>Status</dt><dd>{centre.status}</dd>
      </dl>
    </main>
  );
}
