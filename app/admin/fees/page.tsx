import { pageRead } from "@/server/page-read";
import { listFeeTypes } from "@/server/fees";

// Fees setup index (fee-structure design): readable by every signed-in user; fee.setup changes it.
export default async function Fees() {
  await pageRead((s) => listFeeTypes(s)); // requires a session
  return (
    <main>
      <p><a href="/">Home</a> · <a href="/admin/catalogue">Catalogue</a></p>
      <h1>Fees</h1>
      <ul>
        <li><a href="/admin/catalogue/masters/fee-categories">Fee categories</a></li>
        <li><a href="/admin/fees/types">Fee types</a></li>
        <li><a href="/admin/fees/captions">Instalments</a></li>
        <li><a href="/admin/fees/plans">Fee plans</a></li>
        <li><a href="/admin/fees/schemes">Fee schemes</a></li>
      </ul>
    </main>
  );
}
