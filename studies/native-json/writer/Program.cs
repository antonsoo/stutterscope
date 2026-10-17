// Controlled serializer exercise using the pinned upstream session classes.
// This creates synthetic data; it does not record a game or run the Windows client.
using System;
using System.IO;
using System.Text;
using CapFrameX.Data.Session.Classes;
using Newtonsoft.Json;

static class Program
{
    static SessionRun Run(double[] frames, bool telemetry)
    {
        var data = new SessionCaptureData(frames.Length) { MsBetweenPresents = frames };
        double elapsed = 0;
        for (int i = 0; i < frames.Length; i++)
        {
            data.TimeInSeconds[i] = elapsed;
            if (double.IsFinite(frames[i])) elapsed += frames[i] / 1000;
            data.Dropped[i] = i == 1;
            data.MsUntilDisplayed[i] = i == 2 ? double.NaN : 4 + i;
            data.FrameType[i] = i % 2 == 0 ? "Application" : "Repeated";
        }
        if (telemetry)
        {
            for (int i = 0; i < frames.Length; i++)
            {
                data.CpuActive[i] = i == 3 ? double.NaN : 2 + i;
                data.GpuActive[i] = 3 + i;
            }
        }
        else { data.CpuActive = null; data.GpuActive = null; }
        return new SessionRun { Hash = "synthetic-run", CaptureData = data };
    }

    static void Main(string[] args)
    {
        var session = new Session {
            Hash = "synthetic-serializer-exercise",
            Info = new SessionInfo {
                AppVersion = new Version(1, 9, 1, 5),
                Id = new Guid("28b58603-e77e-4415-92f7-627f099ef443"),
                ProcessName = "synthetic-serializer.exe",
                CreationDate = new DateTime(2026, 10, 17, 0, 0, 0, DateTimeKind.Utc),
                Comment = "Synthetic input serialized by upstream CapFrameX session types; not a recorded game benchmark"
            }
        };
        session.Runs.Add(Run(new double[] { 10, 100, double.NaN, 100, 100, 10 }, true));
        session.Runs.Add(Run(new double[] { 20, 20, 20, 20 }, false));
        // Same serializer/default settings and UTF-8 StreamWriter construction
        // as RecordManager.SaveSessionToFile at the pinned upstream commit.
        using (var writer = new StreamWriter(args[0], false, Encoding.UTF8))
        using (var json = new JsonTextWriter(writer))
        {
            var serializer = new JsonSerializer();
            serializer.Serialize(json, session);
        }
    }
}
