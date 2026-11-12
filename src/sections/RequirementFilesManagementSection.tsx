import { useEffect, useState } from "react";
import { Clock, Download, Edit2, Eye, EyeOff, FileText, FolderOpen, Globe, Lock, Plus, Trash2, UploadCloud, Users } from "lucide-react";
import { toast } from "sonner";
import { studentRequirementFilesService, studentsService } from "@/services/db";
import type { Student, StudentRequirementFile, UserRole } from "@/types";
import { formatDate } from "@/lib/format";
import { useSearch } from "@/hooks/useSearch";
import { FilePreviewModal, FileSize } from "@/components/FilePreview";
import Page from "@/components/ui/Page";
import Modal from "@/components/ui/Modal";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Field from "@/components/ui/Field";
import SearchInput from "@/components/ui/SearchInput";
import StatCard from "@/components/ui/StatCard";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton, { LoadingCard } from "@/components/ui/Skeleton";
import { Menu, MenuContent, MenuItem, MenuSeparator, RowActionsTrigger } from "@/components/ui/Menu";

interface RequirementFilesManagementSectionProps {
  onBack: () => void;
  role: UserRole;
  userId?: string;
}

const ACCEPT = "application/pdf,image/*,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,audio/*,video/*";
const studentText = (s: Student) => `${s.name} ${s.studentId}`;

/** null = closed, "new" = upload, otherwise the file being edited/replaced. */
type EditTarget = StudentRequirementFile | "new" | null;

export default function RequirementFilesManagementSection({ onBack, role, userId = "" }: RequirementFilesManagementSectionProps) {
  const allowed = role === "admin" || role === "secretary";
  const [files, setFiles] = useState<StudentRequirementFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [editing, setEditing] = useState<EditTarget>(null);
  const [form, setForm] = useState({ title: "", description: "", publish: true });
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StudentRequirementFile | null>(null);
  const [previewFile, setPreviewFile] = useState<StudentRequirementFile | null>(null);

  // Manage-access dialog (student-specific downloads)
  const [accessTarget, setAccessTarget] = useState<StudentRequirementFile | null>(null);
  const [restricted, setRestricted] = useState(false);
  const [students, setStudents] = useState<Student[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const studentSearch = useSearch(students, studentText);

  useEffect(() => {
    if (!allowed) return;
    studentRequirementFilesService
      .getAll()
      .then(setFiles)
      .catch((error) => {
        console.error("Error loading files:", error);
        toast.error("Failed to load files");
      })
      .finally(() => setLoading(false));
  }, [allowed]);

  if (!allowed) {
    return (
      <Page title="Council Files" onBack={onBack}>
        <div className="card">
          <EmptyState icon={EyeOff} title="You do not have permission to manage files." />
        </div>
      </Page>
    );
  }

  const upsert = (file: StudentRequirementFile) => setFiles((prev) => prev.map((f) => (f.id === file.id ? file : f)));

  /** Runs a save/delete with the shared spinner state; returns true on success. */
  const run = async (action: () => Promise<void>, failure: string) => {
    setSaving(true);
    try {
      await action();
      return true;
    } catch (error) {
      console.error(failure, error);
      toast.error(`${failure} Please try again.`);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const openEditor = (file: StudentRequirementFile | "new") => {
    setForm(file === "new" ? { title: "", description: "", publish: true } : { title: file.title, description: file.description ?? "", publish: file.isPublished });
    setPickedFile(null);
    setEditing(file);
  };

  const handleSubmit = async () => {
    const title = form.title.trim();
    if (!title) return toast.error("Please provide a title for the file.");
    if (editing === "new" && !pickedFile) return toast.error("Please choose a file to upload.");
    const meta = { title, description: form.description.trim() || undefined, isPublished: form.publish };

    const ok = await run(async () => {
      if (editing === "new") {
        const created = await studentRequirementFilesService.create({ ...meta, file: pickedFile!, fileName: pickedFile!.name, createdBy: userId });
        setFiles((prev) => [created, ...prev]);
        toast.success("File uploaded successfully.");
      } else if (editing) {
        let updated = await studentRequirementFilesService.update(editing.id, meta);
        if (pickedFile) updated = await studentRequirementFilesService.replaceFile(editing.id, pickedFile, pickedFile.name);
        upsert(updated);
        toast.success(pickedFile ? "File replaced successfully." : "File updated.");
      }
    }, "Failed to save the file.");
    if (ok) setEditing(null);
  };

  const togglePublish = async (file: StudentRequirementFile) => {
    try {
      const updated = await studentRequirementFilesService.update(file.id, { isPublished: !file.isPublished });
      upsert(updated);
      toast.success(updated.isPublished ? `"${updated.title}" is now published and visible to students.` : `"${updated.title}" is now hidden from students.`);
    } catch (error) {
      console.error("Error toggling publish state:", error);
      toast.error("Failed to update publish state. Please try again.");
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const ok = await run(async () => {
      await studentRequirementFilesService.delete(deleteTarget.id);
      setFiles((prev) => prev.filter((f) => f.id !== deleteTarget.id));
      toast.success("File deleted.");
    }, "Failed to delete the file.");
    if (ok) setDeleteTarget(null);
  };

  const openAccess = async (file: StudentRequirementFile) => {
    setAccessTarget(file);
    setRestricted(file.restricted);
    studentSearch.reset();
    setStudentsLoading(true);
    try {
      const [all, accessIds] = await Promise.all([
        students.length ? students : studentsService.getAll(),
        studentRequirementFilesService.getAccessList(file.id),
      ]);
      setStudents(all);
      setSelectedIds(new Set(accessIds));
    } catch (error) {
      console.error("Error loading student access list:", error);
      toast.error("Failed to load students. Please try again.");
      setAccessTarget(null);
    } finally {
      setStudentsLoading(false);
    }
  };

  const toggleStudent = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const handleSaveAccess = async () => {
    if (!accessTarget) return;
    const ok = await run(async () => {
      if (restricted !== accessTarget.restricted) upsert(await studentRequirementFilesService.update(accessTarget.id, { restricted }));
      await studentRequirementFilesService.setAccessList(accessTarget.id, [...selectedIds]);
      toast.success("Student access updated.");
    }, "Failed to update student access.");
    if (ok) setAccessTarget(null);
  };

  const published = files.filter((f) => f.isPublished).length;
  const isNew = editing === "new";
  const closeUnlessSaving = (close: () => void) => () => !saving && close();

  return (
    <Page
      eyebrow="Council files"
      title="Council Files"
      subtitle="Upload and manage the documents students need, and control who can download them."
      onBack={onBack}
      actions={
        <button onClick={() => openEditor("new")} className="btn btn-primary">
          <Plus className="h-4 w-4" /> Upload file
        </button>
      }
      hero={
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard featured icon={FolderOpen} label="Total files" value={files.length} />
          <StatCard icon={Eye} tone="success" label="Published" value={published} hint={`${files.length - published} hidden`} />
          <StatCard icon={Lock} tone="warning" label="Restricted" value={files.filter((f) => f.restricted).length} hint="Selected students only" />
        </div>
      }
    >
      {loading ? (
        <LoadingCard />
      ) : files.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={FolderOpen}
            title="No files uploaded yet"
            description="Upload the first document students need."
            action={
              <button onClick={() => openEditor("new")} className="btn btn-primary">
                <Plus className="h-4 w-4" /> Upload file
              </button>
            }
          />
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div data-lenis-prevent className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Status</th>
                  <th>Access</th>
                  <th>Updated</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <tr key={file.id}>
                    <td className="min-w-[16rem]">
                      <div className="flex items-start gap-3">
                        <div className="icon-tile h-10 w-10">
                          <FileText className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold">{file.title}</p>
                          {file.description && <p className="line-clamp-2 max-w-md text-xs text-muted">{file.description}</p>}
                          <p className="mt-0.5 text-xs text-muted">
                            {file.fileName} · <FileSize bytes={file.fileSize} />
                          </p>
                        </div>
                      </div>
                    </td>
                    <td>
                      <button
                        role="switch"
                        aria-checked={file.isPublished}
                        onClick={() => togglePublish(file)}
                        className={`chip ${file.isPublished ? "chip-success" : "chip-neutral"} hover:brightness-95`}
                        title={file.isPublished ? "Unpublish (hide from students)" : "Publish (show to students)"}
                      >
                        {file.isPublished ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                        {file.isPublished ? "Published" : "Hidden"}
                      </button>
                    </td>
                    <td>
                      {file.restricted ? (
                        <span className="chip chip-warning">
                          <Lock className="h-3.5 w-3.5" /> Selected students
                        </span>
                      ) : (
                        <span className="chip chip-neutral">
                          <Globe className="h-3.5 w-3.5" /> Everyone
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-muted">{formatDate(file.updatedAt)}</td>
                    <td className="text-right">
                      <Menu>
                        <RowActionsTrigger label={`Actions for ${file.title}`} />
                        <MenuContent>
                          {file.fileUrl ? (
                            <>
                              <MenuItem onSelect={() => setPreviewFile(file)}>
                                <Eye /> Preview
                              </MenuItem>
                              <MenuItem asChild>
                                <a href={file.fileUrl} download={file.fileName} target="_blank" rel="noopener noreferrer">
                                  <Download /> Download
                                </a>
                              </MenuItem>
                            </>
                          ) : (
                            <MenuItem disabled>
                              <Clock /> Still syncing…
                            </MenuItem>
                          )}
                          <MenuItem onSelect={() => openAccess(file)}>
                            <Users /> Manage access
                          </MenuItem>
                          <MenuItem onSelect={() => openEditor(file)}>
                            <Edit2 /> Edit or replace file
                          </MenuItem>
                          <MenuItem onSelect={() => togglePublish(file)}>
                            {file.isPublished ? <EyeOff /> : <Eye />} {file.isPublished ? "Unpublish" : "Publish"}
                          </MenuItem>
                          <MenuSeparator />
                          <MenuItem danger onSelect={() => setDeleteTarget(file)}>
                            <Trash2 /> Delete
                          </MenuItem>
                        </MenuContent>
                      </Menu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />

      <Modal
        open={editing !== null}
        onClose={closeUnlessSaving(() => setEditing(null))}
        title={isNew ? "Upload file" : "Edit file"}
        description={isNew ? "Add a document for students." : "Update the details, or choose a new file to replace the current one."}
        icon={<UploadCloud className="h-5 w-5 text-brand-500" />}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
              {saving ? (isNew || pickedFile ? "Uploading…" : "Saving…") : isNew ? "Upload" : "Save"}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Title *">
            <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Enrollment Requirements Checklist" />
          </Field>
          <Field label="Description">
            <textarea
              className="input resize-none"
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Optional short summary of this document"
            />
          </Field>
          <Field
            label={isNew ? "File *" : "Replace file (optional)"}
            hint={pickedFile ? <>Selected: {pickedFile.name} (<FileSize bytes={pickedFile.size} />)</> : !isNew && "The current file is removed and the new one becomes active."}
          >
            <input
              type="file"
              accept={ACCEPT}
              onChange={(e) => setPickedFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-muted file:mr-3 file:cursor-pointer file:rounded-full file:border-0 file:bg-brand-500 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
            />
          </Field>
          <label className="flex cursor-pointer items-center gap-3 text-sm text-ink">
            <input type="checkbox" className="input" checked={form.publish} onChange={(e) => setForm({ ...form, publish: e.target.checked })} />
            Publish (visible to students in Records)
          </label>
        </div>
      </Modal>

      <Modal
        open={!!accessTarget}
        onClose={closeUnlessSaving(() => setAccessTarget(null))}
        size="lg"
        title="Manage access"
        description={<>Choose who can download <b className="text-ink">{accessTarget?.title}</b>.</>}
        icon={<Users className="h-5 w-5 text-brand-500" />}
        footer={
          <>
            <span className="mr-auto self-center text-xs text-muted">
              {selectedIds.size} student{selectedIds.size === 1 ? "" : "s"} selected
            </span>
            <button className="btn btn-secondary" onClick={() => setAccessTarget(null)} disabled={saving}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={handleSaveAccess} disabled={saving || studentsLoading}>
              {saving ? "Saving…" : "Save"}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <label className="flex cursor-pointer items-start gap-3 text-sm text-ink">
            <input type="checkbox" className="input mt-0.5" checked={restricted} onChange={(e) => setRestricted(e.target.checked)} />
            Restrict to selected students only (unchecked = everyone once published)
          </label>
          <SearchInput value={studentSearch.query} onChange={studentSearch.setQuery} placeholder="Search students by name or ID…" />
          <div className="max-h-64 divide-y divide-line overflow-y-auto rounded-2xl border border-line">
            {studentsLoading ? (
              <div className="space-y-2 p-3">
                {Array.from({ length: 4 }, (_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : studentSearch.filtered.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted">No students found.</p>
            ) : (
              studentSearch.filtered.map((student) => (
                <label key={student.id} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-surface-2">
                  <input type="checkbox" className="input" checked={selectedIds.has(student.id)} onChange={() => toggleStudent(student.id)} />
                  <span className="flex-1 text-sm text-ink">{student.name}</span>
                  <span className="text-xs text-muted">{student.studentId}</span>
                </label>
              ))
            )}
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete file"
        description={`Delete "${deleteTarget?.title}"? The file will be permanently removed. This action cannot be undone.`}
        confirmLabel="Delete file"
        loading={saving}
      />
    </Page>
  );
}
