import { useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import { FolderSync, Smartphone } from "lucide-react";
import { useStore } from "../state/store";
import * as A from "../state/actions";
import * as I from "../state/inbox";
import { Dialog } from "../ui/Dialog";
import { t } from "../i18n";

function QrCode({ text, size = 196 }: { text: string; size?: number }) {
  const cells = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const rects: string[] = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) rects.push(`M${c + 4} ${r + 4}h1v1h-1z`);
    return { n: n + 8, d: rects.join("") };
  }, [text]);
  return (
    <svg className="qr" width={size} height={size} viewBox={`0 0 ${cells.n} ${cells.n}`} shapeRendering="crispEdges" role="img" aria-label={t("QR code")}>
      <rect width={cells.n} height={cells.n} fill="#ffffff" />
      <path d={cells.d} fill="#1d1a1c" />
    </svg>
  );
}

export function PhoneDialog() {
  const settings = useStore((s) => s.settings);
  const phone = useStore((s) => s.phone);
  const inboxCount = useStore((s) => s.inbox.length);
  const [which, setWhich] = useState(0);
  const [port, setPort] = useState(String(settings.phonePort));
  const urls = phone.status?.urls ?? [];
  const url = urls[Math.min(which, Math.max(0, urls.length - 1))];

  return (
    <Dialog
      title={t("Connect Phone")}
      icon={<Smartphone size={16} />}
      onClose={A.closeDialog}
      footer={
        <>
          {phone.status && (
            <button className="btn btn-ghost" onClick={() => void I.stopPhoneLink()}>
              {t("Turn Off")}
            </button>
          )}
          <span className="grow" />
          {inboxCount > 0 && (
            <button
              className="btn"
              onClick={() => {
                A.closeDialog();
                I.openInbox();
              }}
            >
              {t("Open Inbox ({n})", { n: inboxCount })}
            </button>
          )}
          <button className="btn btn-primary" onClick={A.closeDialog}>
            {t("Done")}
          </button>
        </>
      }
    >
      <div className="phone-dialog">
        {!phone.status ? (
          <div className="phone-off">
            <p>{t("Take photos of problems and of your written answers with your phone; they arrive in Marée's inbox, where you crop them into problems.")}</p>
            <p className="faint">{t("The phone and this computer must be on the same Wi-Fi. Nothing leaves your network.")}</p>
            {phone.error && <p className="phone-error">{phone.error}</p>}
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-primary" onClick={() => void I.startPhoneLink()}>
                {t("Turn On Phone Link")}
              </button>
              {phone.error && (
                <label className="row faint" style={{ gap: 6 }}>
                  {t("Port")}
                  <input
                    className="input"
                    style={{ width: 90 }}
                    value={port}
                    onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))}
                    onBlur={() => {
                      const n = Number(port);
                      if (n >= 1024 && n <= 65535) void A.updateSettings({ phonePort: n });
                    }}
                  />
                </label>
              )}
            </div>
          </div>
        ) : (
          <div className="phone-on">
            {url ? (
              <>
                <QrCode text={url} />
                <ol className="phone-steps">
                  <li>{t("Connect the phone to the same Wi-Fi as this computer.")}</li>
                  <li>{t("Scan the code with the phone's camera and open the link.")}</li>
                  <li>{t("Add the page to the home screen (iPhone: Share → Add to Home Screen; Android: ⋮ → Add to Home screen) for one-tap access.")}</li>
                </ol>
                <div className="phone-url selectable" title={url}>
                  {url.replace(/\?k=.*/, "")}
                </div>
                {urls.length > 1 && (
                  <button className="btn btn-ghost btn-sm" onClick={() => setWhich((which + 1) % urls.length)}>
                    {t("Phone cannot connect? Try another address ({i}/{n})", { i: which + 1, n: urls.length })}
                  </button>
                )}
                <p className="faint small">
                  {t("If Windows asks whether Marée may use private networks, allow it. Campus and public Wi-Fi often block devices from reaching each other; use a folder there instead.")}
                </p>
              </>
            ) : (
              <p className="phone-error">{t("This computer has no local network address. Connect it to Wi-Fi or Ethernet.")}</p>
            )}
          </div>
        )}

        <div className="phone-folder">
          <div className="phone-folder-head">
            <FolderSync size={14} /> {t("Away from this Wi-Fi")}
          </div>
          <p className="faint small">
            {t("Upload photos from the phone to a synced folder (for example in Google Drive). Marée collects new photos from it while it is open; the folder itself is left untouched.")}
          </p>
          <div className="row" style={{ gap: 8 }}>
            <span className="phone-folder-path ellipsis" title={settings.inboxFolder}>
              {settings.inboxFolder || t("No folder chosen")}
            </span>
            <button className="btn btn-sm" onClick={() => void I.chooseInboxFolder()}>
              {settings.inboxFolder ? t("Change…") : t("Choose…")}
            </button>
            {settings.inboxFolder && (
              <>
                <button className="btn btn-sm btn-ghost" onClick={() => void I.collectFolder(true)}>
                  {t("Check Now")}
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => void I.setInboxFolder("")}>
                  {t("Stop Watching")}
                </button>
              </>
            )}
          </div>
        </div>

        {phone.status && (
          <button className="link-btn faint small" onClick={() => void I.resetPhoneKey()}>
            {t("Disconnect all paired phones")}
          </button>
        )}
      </div>
    </Dialog>
  );
}
