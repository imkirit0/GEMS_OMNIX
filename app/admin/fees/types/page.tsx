import { pageRead } from "@/server/page-read";
import { GST_RATES, listFeeTypes } from "@/server/fees";
import { AdminErrors } from "../../catalogue/admin-errors";
import { FEE_FIELD_LABELS } from "../labels";

// Fee types (R-051): everyone reads; fee.setup adds, edits and (de)activates (step-up, audited).
export default async function FeeTypes({ searchParams }: { searchParams: Promise<{ error?: string; detail?: string; saved?: string }> }) {
  const { error, detail, saved } = await searchParams;
  const { rows, categories, accounts, canManage } = await pageRead((s) => listFeeTypes(s));
  const account = (v: number | null, label: string) => (
    <select name="accountId" defaultValue={v ?? ""} aria-label={label}><option value="">(no account)</option>
      {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</select>
  );
  const save = "/admin/fees/types/save";
  const rate = (name: string, v?: string) => (
    <select name={name} defaultValue={v ?? "18"} aria-label="GST rate">{GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}</select>
  );
  return (
    <main>
      <p><a href="/admin/fees">Fees</a></p>
      <h1>Fee types</h1>
      {saved && <p role="status">Saved.</p>}
      <AdminErrors error={error} detail={detail} labels={FEE_FIELD_LABELS} />
      <p>Amounts in fee plans include GST.</p>
      {canManage && (
        <form method="post" action={save}>
          <input type="hidden" name="op" value="create" />
          <label>Code <input name="code" required maxLength={30} /></label>{" "}
          <label>Name <input name="name" required maxLength={200} /></label>{" "}
          <label>Category <select name="categoryId" required defaultValue=""><option value="">Choose…</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</select></label>{" "}
          <label>Order <input name="sortOrder" type="number" min={0} max={9999} required /></label>{" "}
          <label>HSN/SAC <input name="hsnSac" required pattern="[0-9]{4,8}" /></label>{" "}
          <label>GST {rate("gstRate")}</label>{" "}
          <label>Account {account(null, "Account")}</label>{" "}
          <button type="submit">Add</button>
        </form>
      )}
      <table>
        <thead><tr><th>Order</th><th>Code</th><th>Name</th><th>Category</th><th>HSN/SAC</th><th>GST</th><th>Account</th><th>Status</th>{canManage && <th>Change</th>}</tr></thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id}>
              <td>{t.sortOrder}</td><td>{t.code}</td><td>{t.name}</td><td>{t.categoryCode}</td><td>{t.hsnSac}</td><td>{t.gstRate}%</td><td>{t.accountCode ?? "none"}</td>
              <td>{t.active ? "Active" : "Inactive"}</td>
              {canManage && (
                <td>
                  <form method="post" action={save}>
                    <input type="hidden" name="op" value="update" /><input type="hidden" name="id" value={t.id} />
                    <input name="name" required maxLength={200} defaultValue={t.name} aria-label={`Name of ${t.code}`} />{" "}
                    <input name="sortOrder" type="number" min={0} max={9999} defaultValue={t.sortOrder} aria-label={`Order of ${t.code}`} />{" "}
                    <input name="hsnSac" defaultValue={t.hsnSac} pattern="[0-9]{4,8}" aria-label={`HSN/SAC of ${t.code}`} />{" "}
                    {rate("gstRate", t.gstRate)}{" "}{account(t.accountId, `Account of ${t.code}`)}{" "}<button type="submit">Save</button>
                  </form>
                  <form method="post" action={save}>
                    <input type="hidden" name="op" value="active" /><input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="active" value={t.active ? "0" : "1"} />
                    <input name="reason" required placeholder="Reason" aria-label={`Reason for ${t.code}`} />{" "}
                    <button type="submit">{t.active ? "Deactivate" : "Activate"}</button>
                  </form>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p>No fee types yet.</p>}
    </main>
  );
}
