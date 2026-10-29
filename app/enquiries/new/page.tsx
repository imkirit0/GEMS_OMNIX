import { notFound } from "next/navigation";
import { enquiryOptions } from "@/server/enquiry";
import { pageRead } from "@/server/page-read";
import NewEnquiryForm from "./form";

// Record an enquiry (R-081; enquiry design G1). Needs enquiry.manage at some centre; otherwise 404.
export default async function NewEnquiry() {
  const options = await pageRead((s) => enquiryOptions(s));
  if (!options.centres.some((c) => c.manage && c.active)) notFound();
  return (
    <main>
      <p><a href="/enquiries">All enquiries</a></p>
      <h1>New enquiry</h1>
      <NewEnquiryForm options={options} />
    </main>
  );
}
