import { useState } from "react";
import { ChevronDown, Download, ExternalLink, FileCode2, FileImage, Receipt } from "lucide-react";
import { toast } from "sonner";
import Modal from "@/components/ui/Modal";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/Menu";
import { downloadReceipt, isSvgUrl, type ReceiptFormat } from "@/lib/receipts";

interface ReceiptViewerProps {
  receiptUrl: string | null;
  onClose: () => void;
  title?: string;
}

/** Export formats offered for auto-generated (SVG) receipts. */
const EXPORT_FORMATS = [
  { format: "svg", label: "SVG (vector)", icon: FileCode2 },
  { format: "png", label: "PNG (image)", icon: FileImage },
  { format: "jpg", label: "JPG (image)", icon: FileImage },
] as const;

/** Receipt preview dialog with "open in new tab" and download/export actions. */
export default function ReceiptViewer({ receiptUrl, onClose, title = "Receipt" }: ReceiptViewerProps) {
  const [downloading, setDownloading] = useState(false);
  const isGeneratedSvg = !!receiptUrl && isSvgUrl(receiptUrl);
  const isPdf = !!receiptUrl && /\.pdf(?:$|[?#])/i.test(receiptUrl);

  const download = async (format: ReceiptFormat) => {
    if (!receiptUrl) return;
    try {
      setDownloading(true);
      toast.success(await downloadReceipt(receiptUrl, format));
    } catch (error) {
      console.error("Error downloading receipt:", error);
      toast.error("Failed to download receipt. Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  const downloadLabel = (
    <>
      <Download className="h-4 w-4" />
      {downloading ? "Downloading…" : "Download"}
    </>
  );

  return (
    <Modal
      open={!!receiptUrl}
      onClose={onClose}
      title={title}
      description={isGeneratedSvg ? "Auto-generated receipt — export as SVG, PNG, or JPG." : undefined}
      icon={<Receipt className="h-5 w-5" />}
      size="xl"
      footer={
        receiptUrl && (
          <>
            <button className="btn btn-secondary" onClick={() => window.open(receiptUrl, "_blank", "noopener,noreferrer")}>
              <ExternalLink className="h-4 w-4" />
              Open in new tab
            </button>
            {isGeneratedSvg ? (
              <Menu>
                <MenuTrigger asChild>
                  <button className="btn btn-primary" disabled={downloading}>
                    {downloadLabel}
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </MenuTrigger>
                <MenuContent>
                  {EXPORT_FORMATS.map(({ format, label, icon: Icon }) => (
                    <MenuItem key={format} onSelect={() => download(format)}>
                      <Icon />
                      {label}
                    </MenuItem>
                  ))}
                </MenuContent>
              </Menu>
            ) : (
              <button className="btn btn-primary" onClick={() => download("svg")} disabled={downloading}>
                {downloadLabel}
              </button>
            )}
          </>
        )
      }
    >
      {receiptUrl && (
        <div className="max-h-[60vh] overflow-auto rounded-2xl border border-line bg-surface-2">
          {isPdf ? (
            <iframe src={receiptUrl} title="Receipt PDF" className="h-[60vh] w-full" />
          ) : (
            <img
              src={receiptUrl}
              alt="Receipt"
              className="w-full"
              onError={(e) => {
                e.currentTarget.src = "/receipts/placeholder.svg";
              }}
            />
          )}
        </div>
      )}
    </Modal>
  );
}
