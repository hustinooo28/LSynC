import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Edit2, FileSpreadsheet, Plus, QrCode, Trash2, UserPlus, Users } from "lucide-react";
import type { Student } from "@/types";
import { studentsService } from "@/services/db";
import { getOrdinalSuffix } from "@/lib/format";
import { pickField } from "@/lib/spreadsheet";
import { PROGRAMS } from "@/lib/constants";
import { useSearch } from "@/hooks/useSearch";
import { usePagination } from "@/hooks/usePagination";
import { useSpreadsheetImport } from "@/hooks/useSpreadsheetImport";
import Page from "@/components/ui/Page";
import Modal from "@/components/ui/Modal";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Field from "@/components/ui/Field";
import SearchInput from "@/components/ui/SearchInput";
import Pagination from "@/components/ui/Pagination";
import EmptyState from "@/components/ui/EmptyState";
import { LoadingCard } from "@/components/ui/Skeleton";
import { Menu, MenuContent, MenuItem, MenuSeparator, RowActionsTrigger } from "@/components/ui/Menu";
import StudentQrModal from "@/components/StudentQrModal";

type StudentForm = Omit<Student, "id">;
const EMPTY_FORM: StudentForm = { studentId: "", name: "", program: "", yearLevel: 1, section: "" };

const yearLabel = (year: number) => `${year}${getOrdinalSuffix(year)} Year`;
// Filter by section letter only, so "1A" and "A" group together.
const sectionKey = (s: Student) => s.section?.trim().replace(/^\d+/, "") ?? "";
const searchText = (s: Student) => `${s.name} ${s.studentId}`;
const FILTERS = {
  program: (s: Student) => s.program,
  year: (s: Student) => String(s.yearLevel),
  section: sectionKey,
};
const FILTER_LABELS = { program: "All programs", year: "All years", section: "All sections" } as const;

const initials = (name: string) => {
  const words = name.trim().split(/\s+/);
  return ((words[0]?.[0] ?? "") + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase();
};

const uniqueSorted = <T,>(values: T[]) =>
  [...new Set(values.filter((v) => v !== "" && v != null))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

export default function StudentManagementSection({ onBack }: { onBack: () => void }) {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  // `null` = closed, `"new"` = add, a Student = edit.
  const [editing, setEditing] = useState<Student | "new" | null>(null);
  const [form, setForm] = useState<StudentForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<Student | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [qrStudent, setQrStudent] = useState<Student | null>(null);

  useEffect(() => {
    studentsService
      .getAll()
      .then(setStudents)
      .catch((error) => {
        console.error("Error loading students:", error);
        toast.error("Failed to load students");
      })
      .finally(() => setLoading(false));
  }, []);

  const { query, setQuery, filters, setFilter, filtered } = useSearch(students, searchText, FILTERS);
  const { pageItems, pagination } = usePagination(filtered, 15);

  const options = useMemo(
    () => ({
      program: uniqueSorted(students.map((s) => s.program?.trim())).map((p) => [p, p]),
      year: uniqueSorted(students.map((s) => s.yearLevel)).map((y) => [String(y), yearLabel(y)]),
      section: uniqueSorted(students.map(sectionKey)).map((s) => [s, `Section ${s}`]),
    }),
    [students],
  );

  const isDuplicateId = (studentId: string, exceptId?: string) =>
    students.some((s) => s.id !== exceptId && s.studentId.toLowerCase() === studentId.toLowerCase());

  const openForm = (student: Student | "new") => {
    setForm(student === "new" ? EMPTY_FORM : { ...student });
    setEditing(student);
  };

  const save = async () => {
    if (!editing) return;
    const data: StudentForm = {
      studentId: form.studentId.trim(),
      name: form.name.trim(),
      program: form.program.trim(),
      yearLevel: form.yearLevel,
      section: form.section.trim(),
    };
    if (!data.studentId || !data.name || !data.program || !data.section) {
      toast.error("Please complete all student fields");
      return;
    }
    const current = editing === "new" ? null : editing;
    if (isDuplicateId(data.studentId, current?.id)) {
      toast.error("A student with this Student ID already exists");
      return;
    }
    setSaving(true);
    try {
      if (current) {
        const updated = await studentsService.update(current.id, data);
        setStudents((prev) => prev.map((s) => (s.id === current.id ? updated : s)));
      } else {
        const created = await studentsService.create(data);
        setStudents((prev) => [...prev, created]);
      }
      toast.success(`Student ${current ? "updated" : "added"} successfully`);
      setEditing(null);
    } catch (error) {
      console.error("Error saving student:", error);
      toast.error(`Failed to ${current ? "update" : "add"} student`);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await studentsService.delete(toDelete.id);
      setStudents((prev) => prev.filter((s) => s.id !== toDelete.id));
      toast.success(`${toDelete.name} has been deleted.`);
      setToDelete(null);
    } catch (error) {
      console.error("Error deleting student:", error);
      toast.error(`Failed to delete ${toDelete.name}.`);
    } finally {
      setDeleting(false);
    }
  };

  const importRows = async (rows: Record<string, string>[]) => {
    if (rows.length === 0) return void toast.error("File is empty or invalid");
    const parsed = rows.map(rowToStudent).filter((s): s is StudentForm => s !== null);
    if (parsed.length === 0) {
      return void toast.error("No valid rows found. Expected columns: Student ID, Name, Program, Year Level, Section");
    }

    // Skip rows already in the table or repeated within the file.
    const seen = new Set(students.map((s) => s.studentId.toLowerCase()));
    const fresh = parsed.filter((s) => {
      const key = s.studentId.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (fresh.length === 0) return void toast.info("All rows in the file already exist in the table");

    const { created, failed } = await studentsService.createMany(fresh);
    setStudents((prev) => [...prev, ...created]);
    const skipped = parsed.length - fresh.length;

    if (failed.length > 0) {
      const shown = failed.slice(0, 5).map((f) => `${f.name || f.studentId}: ${f.error}`);
      const more = failed.length > 5 ? `, +${failed.length - 5} more` : "";
      toast.error(`${created.length} imported, ${failed.length} row(s) failed`, { description: shown.join("; ") + more });
    } else {
      toast.success(
        skipped > 0
          ? `${created.length} student(s) imported, ${skipped} duplicate(s) skipped`
          : `${created.length} student(s) imported successfully`,
      );
    }
  };

  const { importing, handleFileSelected, importInputRef } = useSpreadsheetImport({ onRows: importRows });
  const set = <K extends keyof StudentForm>(key: K, value: StudentForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const formIncomplete = !form.studentId.trim() || !form.name.trim() || !form.program.trim() || !form.section.trim();

  return (
    <Page
      eyebrow="Records"
      title="Student Management"
      subtitle="Manage student records, attendance passes and bulk imports."
      onBack={onBack}
      actions={
        <>
          <button
            onClick={() => importInputRef.current?.click()}
            className="btn border border-white/20 bg-white/10 text-white hover:bg-white/20"
            disabled={loading || importing}
            title="Import from .csv or .xlsx. Expected columns: Student ID, Name, Program, Year Level, Section."
          >
            <FileSpreadsheet className="h-4 w-4" />
            {importing ? "Importing…" : "Import CSV / Excel"}
          </button>
          <button onClick={() => openForm("new")} className="btn btn-primary" disabled={loading || importing}>
            <Plus className="h-4 w-4" /> Add student
          </button>
        </>
      }
    >
      <input
        ref={importInputRef}
        type="file"
        accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={handleFileSelected}
      />

      <div className="card flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
        <SearchInput value={query} onChange={setQuery} placeholder="Search by name or student ID…" className="flex-1" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:w-auto">
          {(Object.keys(FILTER_LABELS) as (keyof typeof FILTER_LABELS)[]).map((key) => (
            <select
              key={key}
              value={filters[key] ?? ""}
              onChange={(e) => setFilter(key, e.target.value)}
              className="input lg:w-40"
              disabled={loading}
              aria-label={FILTER_LABELS[key]}
            >
              <option value="">{FILTER_LABELS[key]}</option>
              {options[key].map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          ))}
        </div>
      </div>

      {loading ? (
        <LoadingCard label="Loading students…" />
      ) : (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-5 py-4">
            <h2 className="font-bold text-ink">Students</h2>
            <span className="chip chip-brand">
              {filtered.length === students.length ? `${students.length} total` : `${filtered.length} of ${students.length}`}
            </span>
          </div>
          {filtered.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No students found"
              description={students.length ? "Try a different search or filter." : "Add a student or import a spreadsheet to get started."}
            />
          ) : (
            <>
              <div data-lenis-prevent className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Program</th>
                      <th>Year</th>
                      <th>Section</th>
                      <th className="w-12" />
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <div className="flex items-center gap-3">
                            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-500/10 text-xs font-bold text-brand-600">
                              {initials(s.name)}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate font-semibold">{s.name}</p>
                              <p className="text-xs text-muted">{s.studentId}</p>
                            </div>
                          </div>
                        </td>
                        <td><span className="chip chip-brand">{s.program}</span></td>
                        <td className="whitespace-nowrap text-muted">{yearLabel(s.yearLevel)}</td>
                        <td className="text-muted">{s.section}</td>
                        <td className="text-right">
                          <Menu>
                            <RowActionsTrigger label={`Actions for ${s.name}`} />
                            <MenuContent>
                              <MenuItem onSelect={() => setQrStudent(s)}><QrCode /> Show QR</MenuItem>
                              <MenuItem onSelect={() => openForm(s)}><Edit2 /> Edit</MenuItem>
                              <MenuSeparator />
                              <MenuItem danger onSelect={() => setToDelete(s)}><Trash2 /> Delete</MenuItem>
                            </MenuContent>
                          </Menu>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination {...pagination} />
            </>
          )}
        </div>
      )}

      <Modal
        open={editing !== null}
        onClose={() => !saving && setEditing(null)}
        icon={<UserPlus className="h-5 w-5 text-brand-500" />}
        title={editing === "new" ? "Add student" : "Edit student"}
        description="Student ID must be unique."
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setEditing(null)} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={saving || formIncomplete}>
              {saving ? "Saving…" : editing === "new" ? "Save student" : "Update student"}
            </button>
          </>
        }
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Field label="Student ID">
            <input className="input" value={form.studentId} onChange={(e) => set("studentId", e.target.value)} placeholder="e.g. 2021-00001" disabled={saving} />
          </Field>
          <Field label="Full name">
            <input className="input" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Juan Dela Cruz" disabled={saving} />
          </Field>
          <Field label="Program">
            <input className="input" list="program-suggestions" value={form.program} onChange={(e) => set("program", e.target.value)} placeholder="e.g. BSIT, ACT, DIT" disabled={saving} />
            <datalist id="program-suggestions">
              {PROGRAMS.map((p) => <option key={p} value={p} />)}
            </datalist>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Year level">
              <select className="input" value={form.yearLevel} onChange={(e) => set("yearLevel", Number(e.target.value))} disabled={saving}>
                {[1, 2, 3, 4, 5].map((y) => <option key={y} value={y}>{yearLabel(y)}</option>)}
              </select>
            </Field>
            <Field label="Section">
              <input className="input" value={form.section} onChange={(e) => set("section", e.target.value)} placeholder="e.g. A" disabled={saving} />
            </Field>
          </div>
          <button type="submit" hidden />
        </form>
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={confirmDelete}
        loading={deleting}
        title="Delete student"
        description={`Delete ${toDelete?.name ?? "this student"}? Their contributions, attendance and payment records will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete student"
      />
      <StudentQrModal student={qrStudent} onClose={() => setQrStudent(null)} />
    </Page>
  );
}

/** Maps one import row to a student; `null` when ID or name is missing. */
function rowToStudent(row: Record<string, string>): StudentForm | null {
  const studentId = pickField(row, "studentid", "studentno", "studentnumber", "studid", "idnumber", "lrn", "id");
  const name = pickField(row, "name", "fullname", "studentname");
  if (!studentId || !name) return null;
  const year = parseInt(pickField(row, "yearlevel", "year", "gradelevel", "grade", "gradelvl"), 10);
  return {
    studentId,
    name,
    program: pickField(row, "program", "course", "degree", "programofstudy"),
    yearLevel: Number.isNaN(year) || year < 1 ? 1 : year,
    section: pickField(row, "section", "class", "block"),
  };
}
