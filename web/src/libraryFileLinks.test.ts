import { describe, expect, it } from "vitest";
import {
  libraryFileLink,
  libraryMountedProvider,
  librarySourceProvider,
} from "./libraryFileLinks";

function mention(sourceUrl: string, query = "asUrl=1") {
  return `chatgpt-library-file://external-gdrive%3Afile%3Aabcde?${query}&sourceUrl=${encodeURIComponent(sourceUrl)}`;
}

describe("Library conversation file URL recognition (_pn/vpn/Zfn)", () => {
  it("selects provider artwork from validated mounted IDs, without inferring it from a source URL", () => {
    expect(libraryMountedProvider("external-gdrive:file:abcde")).toBe(
      "google_drive",
    );
    expect(
      libraryMountedProvider(
        "external-box:account:team%40example.com:file:123",
      ),
    ).toBe("box");
    expect(libraryMountedProvider("external-dropbox:file:id:abc_123")).toBe(
      "dropbox",
    );
    expect(libraryMountedProvider("libfile_example")).toBeNull();
    expect(libraryMountedProvider("external-gdrive:file:x")).toBeNull();
    expect(
      libraryMountedProvider("external-box:account:%74eam:file:123"),
    ).toBeNull();
    expect(libraryMountedProvider("external-box:file:0")).toBeNull();
    expect(libraryMountedProvider("external-dropbox:file:abc_123")).toBeNull();
  });
  it.each([
    ["https://docs.google.com/document/d/abcde/edit", "google_drive"],
    [
      "https://docs.google.com/spreadsheets/u/2/d/sheet-123/edit",
      "google_drive",
    ],
    ["https://docs.google.com/presentation/d/slides_abc/edit", "google_drive"],
    ["https://drive.google.com/file/d/abcde/view", "google_drive"],
    ["https://drive.google.com/a/example.org/open?id=abcde", "google_drive"],
    ["https://app.box.com/file/123?view=detail", "box"],
    ["https://team.app.box.com/file/123/", "box"],
    ["https://www.dropbox.com/scl/fi/abc/file.pdf?rlkey=def", "dropbox"],
    ["https://dropbox.com/preview/folder/file.pdf", "dropbox"],
    ["https://dropbox.com/home/folder?preview=file.pdf", "dropbox"],
    ["https://dropbox.com/embedded_preview?fileId=id%3Aabc-123", "dropbox"],
    ["https://team.sharepoint.com/sites/project/report.docx", "sharepoint"],
    ["https://team.sharepoint.com/:w:/r/sites/project/item", "sharepoint"],
    [
      "https://team.sharepoint.com/sites/a/_layouts/15/Doc.aspx?sourcedoc=abc",
      "sharepoint",
    ],
    ["https://team-my.sharepoint.com/personal/user/report.docx", "onedrive"],
    [
      "https://team-my.sharepoint.com/personal/user/_layouts/15/onedrive.aspx?id=%2Fpersonal%2Fuser%2Freport.docx",
      "onedrive",
    ],
    [
      "https://graph.microsoft.com/v1.0/drives/drive!123/items/item_abc",
      "onedrive",
    ],
  ])("recognizes supported source %s", (source, provider) => {
    expect(librarySourceProvider(source)).toBe(provider);
    expect(libraryFileLink(mention(source))).toMatchObject({
      href: source,
      libraryFileId: "external-gdrive:file:abcde",
      sourceProvider: provider,
    });
  });

  it.each([
    "https://example.com/report.pdf",
    "http://docs.google.com/document/d/abcde/edit",
    "https://docs.google.com/document/d/e/pub",
    "https://docs.google.com/spreadsheets/abcde",
    "https://drive.google.com/drive/folders/abcde",
    "https://app.box.com/s/shared-id",
    "https://app.box.com/file/0",
    "https://www.dropbox.com/sh/folder/shared",
    "https://dropbox.com/home?preview=file.pdf&preview=second.pdf",
    "https://dropbox.com:443/s/abc/file.pdf",
    "https://dropbox.com/s/abc/file.pdf\\extra",
    "https://user@dropbox.com/s/abc/file.pdf",
    "https://team.sharepoint.com/sites/project/",
    "https://team.sharepoint.com/:f:/r/sites/folder",
    "https://team.sharepoint.com/_layouts/15/Doc.aspx?sourcedoc=",
    "https://team.sharepoint.com/path/default.aspx",
    "https://team.sharepoint.com:443/path/report.docx",
    "https://graph.microsoft.com/v1.0/drives/abc/items/def?download=1",
    "https://onedrive.live.com/?id=abc",
    "file:///work/report.pdf",
    "javascript:alert(1)",
  ])("does not promote unsupported URL %s to a file mention", (source) => {
    expect(librarySourceProvider(source)).toBeNull();
    expect(libraryFileLink(mention(source))).toBeNull();
  });

  it("retains mention identity, MIME metadata and the exact source rather than normalizing it", () => {
    const source = "https://docs.google.com/document/d/abcde/edit?x=1#heading",
      href = mention(
        source,
        "asUrl=1&mimeType=application%2Fvnd.google-apps.document",
      );
    expect(libraryFileLink(href)).toEqual({
      mentionPath: href,
      href: source,
      sourceProvider: "google_drive",
      libraryFileId: "external-gdrive:file:abcde",
      mimeType: "application/vnd.google-apps.document",
    });
  });

  it("uses first duplicate values and exact scheme/asUrl strings as in URLSearchParams", () => {
    const source = "https://app.box.com/file/123";
    expect(libraryFileLink(mention(source, "asUrl=0&asUrl=1"))).toBeNull();
    expect(libraryFileLink(mention(source, "asUrl=1&asUrl=0"))).not.toBeNull();
    expect(libraryFileLink(mention(source, "asUrl=true"))).toBeNull();
    expect(
      libraryFileLink(
        mention(source, "asUrl=1&sourceUrl=https%3A%2F%2Fexample.com"),
      ),
    ).toBeNull();
    expect(
      libraryFileLink(mention(source).replace("chatgpt-", "Chatgpt-")),
    ).toBeNull();
  });

  it("rejects empty/malformed IDs and non-exact trimmed sources", () => {
    const source = "https://app.box.com/file/123";
    expect(
      libraryFileLink(
        mention(source).replace("external-gdrive%3Afile%3Aabcde", "%20"),
      ),
    ).toBeNull();
    expect(
      libraryFileLink(
        mention(source).replace("external-gdrive%3Afile%3Aabcde", "%E0%A4%A"),
      ),
    ).toBeNull();
    expect(libraryFileLink(mention(` ${source}`))).toBeNull();
    expect(libraryFileLink(mention(`${source}\n`))).toBeNull();
    expect(libraryFileLink(undefined)).toBeNull();
  });
});
