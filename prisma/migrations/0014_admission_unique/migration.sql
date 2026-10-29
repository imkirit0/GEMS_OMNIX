-- One admission per person, centre and academic year (admission-screens DD-16; PMC under D-ADM-4).
-- CreateIndex
CREATE UNIQUE INDEX "admission_person_centre_year_key" ON "app"."admission"("person_id", "centre_id", "academic_year");
