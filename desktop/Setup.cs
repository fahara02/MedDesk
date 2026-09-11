using System;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Diagnostics;
using System.Windows.Forms;

internal static class Setup {
    [STAThread]
    static int Main(string[] args) {
        string directory = Path.Combine(Path.GetTempPath(), "MedDesk-Setup-" + Guid.NewGuid().ToString("N"));
        try {
            Directory.CreateDirectory(directory);
            using (Stream payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
            using (ZipArchive archive = new ZipArchive(payload, ZipArchiveMode.Read)) {
                foreach (ZipArchiveEntry entry in archive.Entries) {
                    string target = Path.GetFullPath(Path.Combine(directory, entry.FullName));
                    if (!target.StartsWith(directory + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Invalid installer path.");
                    if (String.IsNullOrEmpty(entry.Name)) { Directory.CreateDirectory(target); continue; }
                    Directory.CreateDirectory(Path.GetDirectoryName(target));
                    entry.ExtractToFile(target, false);
                }
            }
            ProcessStartInfo start = new ProcessStartInfo();
            start.FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe");
            start.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -STA -File \"" + Path.Combine(directory, "install.ps1") + "\"";
            if (args.Length == 1 && args[0] == "--check-package") start.Arguments += " -CheckPackage";
            start.UseShellExecute = false; start.CreateNoWindow = true;
            using (Process process = Process.Start(start)) { process.WaitForExit(); return process.ExitCode; }
        } catch (Exception) {
            MessageBox.Show("MedDesk Bridge setup could not run. Extract a fresh installer and retry.", "MedDesk Bridge");
            return 1;
        } finally {
            // Only remove the unique directory created by this installer.
            if (Directory.Exists(directory)) { try { Directory.Delete(directory, true); } catch (IOException) {} }
        }
    }
}
