package com.onsemi.cim.apps.exensio.xfcsreloader.service;

import com.onsemi.cim.apps.exensio.xfcsreloader.config.XfcsProperties;
import com.onsemi.cim.apps.exensio.xfcsreloader.util.FilenameParser;
import com.onsemi.cim.apps.exensio.xfcsreloader.web.dto.ArchiveLotDetail;
import com.onsemi.cim.apps.exensio.xfcsreloader.web.dto.SearchCriteria;
import com.onsemi.cim.apps.exensio.xfcsreloader.web.dto.SearchResult;
import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

@Service
public class ArchiveSearchService {

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(ArchiveSearchService.class);

    private final XfcsProperties xfcsProperties;
    private final EnvConfigService envConfigService;

    public ArchiveSearchService(XfcsProperties xfcsProperties, EnvConfigService envConfigService) {
        this.xfcsProperties = xfcsProperties;
        this.envConfigService = envConfigService;
    }

    public List<SearchResult> search(SearchCriteria criteria) {
        int maxResults = Math.max(1, Math.min(xfcsProperties.getSearchMaxResults(),
                criteria.maxResults() == null ? xfcsProperties.getSearchMaxResults() : criteria.maxResults()));
        int maxScan = Math.max(maxResults, xfcsProperties.getSearchMaxFilesScan());

        Path root = buildSearchRoot(criteria.environment());
        if (!Files.exists(root)) {
            log.warn("[Search] Archive root does not exist: {}", root);
            return List.of();
        }
        
        log.info("[Search] Base archive root identified as: {}", root);

        Set<String> lotIdFilters = toSet(criteria.lotIds());
        List<java.util.regex.Pattern> wildcardPatterns = new ArrayList<>();
        Set<String> exactLots = new HashSet<>();

        for (String filter : lotIdFilters) {
            if (filter.contains("*") || filter.contains("%")) {
                // Convert SQL % and standard * to regex .*, safely escaping periods.
                // Do NOT use Pattern.quote() because injecting .* inside \Q \E makes it a literal search!
                String regex = filter.replace(".", "\\.")
                        .replace("*", ".*")
                        .replace("%", ".*");
                wildcardPatterns.add(java.util.regex.Pattern.compile(regex, java.util.regex.Pattern.CASE_INSENSITIVE));
            } else {
                exactLots.add(filter.toLowerCase(Locale.ROOT));
            }
        }

        Set<Integer> years = criteria.years() == null ? Set.of() : new HashSet<>(criteria.years());
        Set<Integer> months = criteria.months() == null ? Set.of() : new HashSet<>(criteria.months());

        List<SearchResult> out = new ArrayList<>();
        int[] scanned = {0};

        // Performance: if user selected year/month, start searching from the most specific
        // existing subfolders (e.g. {dbCode}/{env}/{year}/{Mar}) instead of scanning all years/months.
        List<Path> rootsToSearch = buildTimePrunedRoots(root, years, months);
        
        log.info("[Search] Beginning scan across {} pruned root paths.", rootsToSearch.size());
        
        boolean isWindows = System.getProperty("os.name").toLowerCase().contains("win");

        for (Path r : rootsToSearch) {
            if (out.size() >= maxResults || scanned[0] >= maxScan) break;
            log.info("[Search] Now scanning directory tree: {}", r);
            if (isWindows) {
                // Legacy fallback for local dev
                searchDir(r, scanned, maxScan, maxResults, wildcardPatterns, exactLots, years, months, out);
            } else {
                searchWithFindCommand(r.toString(), criteria.lotIds(), maxResults - out.size(), wildcardPatterns, exactLots, years, months, out);
            }
        }

        return out;
    }

    private List<Path> buildTimePrunedRoots(Path baseRoot, Set<Integer> years, Set<Integer> months) {
        if ((years == null || years.isEmpty()) && (months == null || months.isEmpty())) {
            return List.of(baseRoot);
        }
        if (years == null || years.isEmpty()) {
            // Without a year we can't safely narrow (directory layout is expected to be year/month).
            return List.of(baseRoot);
        }

        List<Path> roots = new ArrayList<>();
        boolean foundAnyYearFolder = false;

        for (Integer year : years) {
            if (year == null) continue;
            Path yearDir = baseRoot.resolve(String.valueOf(year));
            if (!Files.exists(yearDir) || !Files.isDirectory(yearDir)) continue;

            foundAnyYearFolder = true;

            if (months == null || months.isEmpty()) {
                roots.add(yearDir);
                continue;
            }

            // Look for month directories under this year directory.
            try (java.util.stream.Stream<Path> stream = Files.list(yearDir)) {
                List<Path> children = stream.toList();
                for (Path child : children) {
                    if (!Files.isDirectory(child)) continue;
                    Integer m = parseMonthName(child.getFileName().toString());
                    if (m != null && months.contains(m)) {
                        roots.add(child);
                    }
                }
            } catch (Exception ignored) {
                // If we can't list directories, fall back to scanning the baseRoot.
                roots.clear();
                break;
            }
        }

        // If our pruning couldn't find matching year/month folders, fall back to the original behavior.
        if (!foundAnyYearFolder || roots.isEmpty()) {
            return List.of(baseRoot);
        }

        return roots;
    }

    private void searchWithFindCommand(String root, List<String> rawLotIds, int maxResultsNeeded,
                                       List<java.util.regex.Pattern> wildcardPatterns,
                                       Set<String> exactLots,
                                       Set<Integer> years, Set<Integer> months,
                                       List<SearchResult> out) {
        try {
            List<String> cmd = new ArrayList<>();
            cmd.add("find");
            cmd.add(root);
            cmd.add("-type");
            cmd.add("f");

            // Pre-filter with 'find -iname' to massively reduce the lines sent to Java
            if (rawLotIds != null && !rawLotIds.isEmpty()) {
                cmd.add("(");
                boolean first = true;
                for (String lot : rawLotIds) {
                    if (lot == null || lot.isBlank()) continue;
                    if (!first) cmd.add("-o");
                    cmd.add("-iname");
                    String glob = lot.trim();
                    if (!glob.startsWith("*") && !glob.startsWith("%")) glob = "*" + glob;
                    if (!glob.endsWith("*") && !glob.endsWith("%")) glob = glob + "*";
                    glob = glob.replace("%", "*"); // convert SQL wildcard % to glob *
                    cmd.add(glob);
                    first = false;
                }
                cmd.add(")");
            }

            cmd.add("-print");

            log.info("[Search] Executing native command: {}", cmd.stream().map(s -> s.contains(" ") || s.contains("*") ? "'" + s + "'" : s).collect(java.util.stream.Collectors.joining(" ")));
            ProcessBuilder pb = new ProcessBuilder(cmd);
            pb.redirectErrorStream(true);
            Process process = pb.start();

            try (java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.InputStreamReader(process.getInputStream()))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    if (out.size() >= maxResultsNeeded) {
                        process.destroyForcibly();
                        break;
                    }
                    if (line.contains("Permission denied") || line.contains("No such file or directory")) {
                        continue;
                    }

                    Path p = Path.of(line);
                    String fileName = p.getFileName().toString();
                    String lower = fileName.toLowerCase(Locale.ROOT);

                    // Skip obvious non-data sidecar files. Everything else matched by the lot
                    // -iname filter is considered a valid archive file — using an allowlist here
                    // caused valid extensions like .SPD, .KLARF, .STDF etc. to be dropped.
                    boolean isSidecar = lower.endsWith(".err") || lower.endsWith(".pid")
                        || lower.endsWith(".tmp") || lower.endsWith(".lock")
                        || lower.endsWith(".md5") || lower.endsWith(".md5sum");

                    if (isSidecar) {
                        continue;
                    }

                    // Detailed lot matching using the existing robust logic
                    boolean matchesLot = false;
                    String matchedLotId = null;

                    if (exactLots.isEmpty() && wildcardPatterns.isEmpty()) {
                        matchesLot = true;
                    } else {
                        // 1. Check if ANY exact lot ID is found as a substring in the filename
                        // This handles cases where Part Numbers or other IDs precede the Lot ID.
                        for (String exactLot : exactLots) {
                            if (lower.contains(exactLot)) {
                                matchedLotId = exactLot.toUpperCase(Locale.ROOT);
                                matchesLot = true;
                                break;
                            }
                        }
                        
                        // 2. Check wildcard patterns against filename
                        if (!matchesLot) {
                            for (java.util.regex.Pattern pattern : wildcardPatterns) {
                                if (pattern.matcher(fileName).find()) {
                                    matchesLot = true;
                                    break;
                                }
                            }
                        }
                    }

                    if (!matchesLot) continue;

                    Integer year = extractYear(p);
                    Integer month = extractMonth(p);

                    if (!years.isEmpty() && (year == null || !years.contains(year))) continue;
                    if (!months.isEmpty() && (month == null || !months.contains(month))) continue;
                    
                    // Prefer the matched lot ID from the user's query over brittle parsing
                    String displayLot = matchedLotId != null ? matchedLotId : "UNKNOWN";

                    out.add(new SearchResult(p.toString(), displayLot, fileName, year, month, safeFileSize(p)));
                }
            }
            process.waitFor(60, java.util.concurrent.TimeUnit.SECONDS);
            if (process.isAlive()) process.destroyForcibly();
            
        } catch (Exception e) {
            log.error("[Search] Native find command failed", e);
        }
    }

    private void searchDir(Path dir, int[] scanned, int maxScan, int maxResults, 
                           List<java.util.regex.Pattern> wildcardPatterns, 
                           Set<String> exactLots,
                           Set<Integer> years, Set<Integer> months, 
                           List<SearchResult> out) {
        if (out.size() >= maxResults || scanned[0] >= maxScan) return;
        
        try (java.util.stream.Stream<Path> stream = Files.list(dir)) {
            List<Path> children = stream.toList();
            
            // Separate directories and files
            List<Path> subDirs = new ArrayList<>();
            List<Path> files = new ArrayList<>();
            for (Path p : children) {
                if (Files.isDirectory(p)) subDirs.add(p);
                else files.add(p);
            }

            // Process files
            for (Path p : files) {
                if (out.size() >= maxResults || scanned[0] >= maxScan) return;
                scanned[0]++;
                
                String fileName = p.getFileName().toString();
                String lower = fileName.toLowerCase(Locale.ROOT);
                
                boolean matchesLot = false;
                String matchedLotId = null;

                if (exactLots.isEmpty() && wildcardPatterns.isEmpty()) {
                    matchesLot = true;
                } else {
                    // 1. Check if ANY exact lot ID is found as a substring in the filename
                    for (String exactLot : exactLots) {
                        if (lower.contains(exactLot)) {
                            matchedLotId = exactLot.toUpperCase(Locale.ROOT);
                            matchesLot = true;
                            break;
                        }
                    }
                    // 2. Check wildcard patterns against filename
                    if (!matchesLot) {
                        for (java.util.regex.Pattern pattern : wildcardPatterns) {
                            if (pattern.matcher(fileName).find()) {
                                matchesLot = true;
                                break;
                            }
                        }
                    }
                }

                if (!matchesLot) continue;

                Integer year = extractYear(p);
                Integer month = extractMonth(p);

                if (!years.isEmpty() && (year == null || !years.contains(year))) continue;
                if (!months.isEmpty() && (month == null || !months.contains(month))) continue;

                // Skip sidecar files — accept any extension the lot filter matched.
                boolean isSidecar = lower.endsWith(".err") || lower.endsWith(".pid")
                    || lower.endsWith(".tmp") || lower.endsWith(".lock")
                    || lower.endsWith(".md5") || lower.endsWith(".md5sum");
                if (isSidecar) continue;

                String displayLot = matchedLotId != null ? matchedLotId : "UNKNOWN";

                out.add(new SearchResult(p.toString(), displayLot, fileName, year, month, safeFileSize(p)));
            }

            // Process subdirectories: Sort them descending to prioritize newest archives!
            subDirs.sort((p1, p2) -> {
                String n1 = p1.getFileName().toString();
                String n2 = p2.getFileName().toString();
                if (n1.matches("20\\d{2}") && n2.matches("20\\d{2}")) {
                    return n2.compareTo(n1); // 2026 before 2025
                }
                Integer m1 = parseMonthName(n1);
                Integer m2 = parseMonthName(n2);
                if (m1 != null && m2 != null) {
                    return m2.compareTo(m1); // 12 before 1
                }
                return n2.compareToIgnoreCase(n1);
            });

            for (Path subDir : subDirs) {
                if (out.size() >= maxResults || scanned[0] >= maxScan) return;
                
                // Prune non-matching year/month directories EARLY
                Integer y = extractYear(subDir);
                if (!years.isEmpty() && y != null && !years.contains(y)) {
                    // Check if this specific directory node is a year.
                    if (subDir.getFileName().toString().matches("20\\d{2}")) {
                        continue; 
                    }
                }
                
                Integer m = parseMonthName(subDir.getFileName().toString());
                if (!months.isEmpty() && m != null && !months.contains(m)) continue;
                
                searchDir(subDir, scanned, maxScan, maxResults, wildcardPatterns, exactLots, years, months, out);
            }
            
        } catch (IOException ignored) {}
    }

    private Long safeFileSize(Path path) {
        try {
            return Files.size(path);
        } catch (Exception ex) {
            log.debug("[Search] Could not read size for {}: {}", path, ex.getMessage());
            return null;
        }
    }

    private Integer parseMonthName(String dirName) {
        String v = dirName.toLowerCase(Locale.ROOT);
        if (v.matches("0?[1-9]|1[0-2]")) return Integer.parseInt(v);
        switch (v) {
            case "jan": case "january": return 1;
            case "feb": case "february": return 2;
            case "mar": case "march": return 3;
            case "apr": case "april": return 4;
            case "may": return 5;
            case "jun": case "june": return 6;
            case "jul": case "july": return 7;
            case "aug": case "august": return 8;
            case "sep": case "september": return 9;
            case "oct": case "october": return 10;
            case "nov": case "november": return 11;
            case "dec": case "december": return 12;
        }
        return null;
    }

    public byte[] zipSelected(List<String> paths) {
        try (ByteArrayOutputStream baos = new ByteArrayOutputStream();
             ZipOutputStream zos = new ZipOutputStream(baos, StandardCharsets.UTF_8)) {

            int added = 0;
            if (paths != null) {
                for (String raw : paths) {
                    if (raw == null || raw.isBlank()) continue;
                    Path path = Path.of(raw);
                    if (!Files.exists(path) || !Files.isRegularFile(path)) continue;

                    String entryName = path.getFileName().toString();
                    ZipEntry entry = new ZipEntry(entryName);
                    zos.putNextEntry(entry);
                    Files.copy(path, zos);
                    zos.closeEntry();
                    added++;
                }
            }

            if (added == 0) {
                ZipEntry entry = new ZipEntry("README.txt");
                zos.putNextEntry(entry);
                zos.write("No matching files were available for download.".getBytes(StandardCharsets.UTF_8));
                zos.closeEntry();
            }

            zos.finish();
            return baos.toByteArray();
        } catch (IOException e) {
            return "download failed".getBytes(StandardCharsets.UTF_8);
        }
    }

        public List<ArchiveLotDetail> findLots(String environment, String lot, String wafer) {
        List<String> lots = (lot == null || lot.isBlank()) ? List.of() : List.of(lot);
        SearchCriteria criteria = new SearchCriteria(environment, null, null, null, null, null, lots, 500);
        List<SearchResult> results = search(criteria);

        return results.stream()
            .filter(r -> wafer == null || wafer.isBlank() || matchesWafer(r.filename(), wafer))
            .map(r -> new ArchiveLotDetail(
                r.lotId(),
                extractWafer(r.filename()),
                r.filename(),
                r.year(),
                r.month(),
                r.path(),
                "FOUND",
                "DISCOVERED",
                "PRODUCTION",
                null,
                null
            ))
            .toList();
        }

    private Path buildSearchRoot(String environment) {
        String env = environment == null ? "" : environment.trim();
        if (env.isBlank()) {
            return Path.of(xfcsProperties.getArchivesRoot());
        }

        // Attempt to find the environment's matching dbCode from env.conf cache (e.g. edbcp for cpft_tmt)
        String dbCode = null;
        try {
            for (com.onsemi.cim.apps.exensio.xfcsreloader.web.dto.EnvYearRange e : envConfigService.loadEnvs()) {
                if (env.equalsIgnoreCase(e.environment())) {
                    dbCode = e.dbCode();
                    break;
                }
            }
        } catch (Exception ignored) {}

        if (dbCode != null && !dbCode.isBlank()) {
            Path complexPath = Path.of(xfcsProperties.getArchivesRoot(), dbCode, env);
            if (Files.exists(complexPath)) {
                return complexPath;
            }
        }

        // Fallback to exactly what the legacy service did if dbCode folder is missing
        return Path.of(xfcsProperties.getArchivesRoot(), env);
    }

    private Set<String> toSet(List<String> items) {
        if (items == null || items.isEmpty()) {
            return Set.of();
        }
        Set<String> out = new HashSet<>();
        for (String item : items) {
            if (item != null && !item.isBlank()) {
                out.add(item.toLowerCase(Locale.ROOT).trim());
            }
        }
        return out;
    }

    private String extractWafer(String fileName) {
        return FilenameParser.parseWaferId(fileName);
    }

    private boolean matchesWafer(String fileName, String expectedWafer) {
        String actual = extractWafer(fileName);
        if (actual == null) {
            return false;
        }
        return actual.equalsIgnoreCase(expectedWafer.trim());
    }

    private Integer extractYear(Path path) {
        for (Path part : path) {
            String v = part.toString();
            if (v.matches("20\\d{2}")) {
                return Integer.parseInt(v);
            }
        }
        return null;
    }

    private Integer extractMonth(Path path) {
        for (Path part : path) {
            String v = part.toString().toLowerCase(Locale.ROOT);
            if (v.matches("0?[1-9]|1[0-2]")) {
                return Integer.parseInt(v);
            }
            switch (v) {
                case "jan": case "january": return 1;
                case "feb": case "february": return 2;
                case "mar": case "march": return 3;
                case "apr": case "april": return 4;
                case "may": return 5;
                case "jun": case "june": return 6;
                case "jul": case "july": return 7;
                case "aug": case "august": return 8;
                case "sep": case "september": return 9;
                case "oct": case "october": return 10;
                case "nov": case "november": return 11;
                case "dec": case "december": return 12;
            }
        }
        return null;
    }
}
