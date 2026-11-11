import { useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import readXlsxFile from "read-excel-file/browser";
import { parseCsv, excelRowsToRecords } from "@/lib/spreadsheet";

/**
 * Shared .csv / .xlsx file-read shell: validates the file, parses it (every
 * sheet of a workbook) into header-keyed rows and hands them to `onRows`,
 * which owns mapping, dedupe, persistence and result toasts.
 */
export function useSpreadsheetImport({ onRows }: { onRows: (rows: Record<string, string>[]) => Promise<void> }) {
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;

    const name = file.name.toLowerCase();
    const isCsv = name.endsWith(".csv");
    if (!isCsv && !name.endsWith(".xlsx")) {
      toast.error("Please upload a .csv or .xlsx file");
      return;
    }

    const kind = isCsv ? "CSV" : "Excel";
    setImporting(true);
    try {
      const rows = isCsv
        ? parseCsv(await file.text())
        : (await readXlsxFile(file)).flatMap((sheet) => excelRowsToRecords(sheet.data ?? []));
      await onRows(rows);
    } catch (error) {
      console.error(`Error importing ${kind} file:`, error);
      toast.error(`Failed to import ${kind} file`);
    } finally {
      setImporting(false);
    }
  };

  return { importing, handleFileSelected, importInputRef };
}
