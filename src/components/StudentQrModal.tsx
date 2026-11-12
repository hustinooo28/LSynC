import { useEffect, useState } from "react";
import { Download, QrCode } from "lucide-react";
import { toast } from "sonner";
import type { Student } from "@/types";
import { downloadStudentAttendancePass, studentAttendancePassSvg } from "@/lib/qr";
import Modal from "@/components/ui/Modal";
import Skeleton from "@/components/ui/Skeleton";

interface StudentQrModalProps {
  student: Student | null;
  onClose: () => void;
}

/** Preview + download of a student's attendance pass; the preview is the exact exported SVG. */
export default function StudentQrModal({ student, onClose }: StudentQrModalProps) {
  const [passSrc, setPassSrc] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!student) return;
    let alive = true;
    setPassSrc(null);
    studentAttendancePassSvg(student)
      .then((svg) => alive && setPassSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`))
      .catch((error) => {
        console.error("Error generating attendance pass:", error);
        if (alive) toast.error("Failed to generate the Attendance Pass");
      });
    return () => {
      alive = false;
    };
  }, [student]);

  const download = async (format: "png" | "svg") => {
    if (!student) return;
    setDownloading(true);
    try {
      toast.success(await downloadStudentAttendancePass(student, format));
    } catch (error) {
      console.error("Error downloading attendance pass:", error);
      toast.error("Failed to download the Attendance Pass");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Modal
      open={!!student}
      onClose={onClose}
      size="2xl"
      icon={<QrCode className="h-5 w-5 text-brand-500" />}
      title="Student QR Attendance Pass"
      description="Scan this QR code at LSC events to record attendance. The pass includes the required data privacy notice."
      footer={(["png", "svg"] as const).map((format) => (
        <button
          key={format}
          className={`btn ${format === "png" ? "btn-primary" : "btn-secondary"} flex-1 sm:flex-none`}
          onClick={() => download(format)}
          disabled={downloading || !passSrc}
        >
          <Download className="h-4 w-4" />
          Download {format.toUpperCase()}
        </button>
      ))}
    >
      {/* 12 cm × 6.5 cm pass ratio */}
      <div className="aspect-[12/6.5] w-full overflow-hidden rounded-2xl border border-line bg-white">
        {passSrc ? (
          <img src={passSrc} alt={student ? `Student QR Attendance Pass for ${student.name}` : ""} className="h-full w-full object-contain" />
        ) : (
          <div className="grid h-full place-items-center" role="status" aria-label="Generating attendance pass">
            <Skeleton className="h-3/5 w-3/5" />
          </div>
        )}
      </div>
    </Modal>
  );
}
