#include "explorer.hpp"
#include "switch/dmntcht.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <vector>

namespace ex {
namespace {

State g{};
DmntCheatProcessMetadata g_meta{};
bool g_dmntInitialized = false;

constexpr u64 SCAN_CHUNK = 0x20000;        // 128 KiB per overlay update.
constexpr std::size_t MAX_CANDIDATES = 20000;
constexpr float MAX_ABS_COORD = 20000.0f;
constexpr float MOVE_EPS = 0.25f;
constexpr float JUMP_EPS = 1.0f;

const char* profilePath() {
    return "sdmc:/switch/totk_explorer/profile.txt";
}

bool finiteCoord(float v) {
    return std::isfinite(v) && std::fabs(v) <= MAX_ABS_COORD;
}

bool plausible(Vec3 p) {
    if (!finiteCoord(p.x) || !finiteCoord(p.y) || !finiteCoord(p.z))
        return false;
    return !(p.x == 0.0f && p.y == 0.0f && p.z == 0.0f);
}

void fail(const char* message) {
    g.stage = ScanStage::Failed;
    g.error = message;
    g.message = message;
}

bool findTargetProcess() {
    if (R_FAILED(dmntchtGetCheatProcessMetadata(&g_meta)))
        return false;

    if (g_meta.title_id != TITLE_ID)
        return false;

    if (g_meta.process_id == 0 || g_meta.heap_extents.base == 0 || g_meta.heap_extents.size < 0x1000)
        return false;

    g.processId = g_meta.process_id;
    g.heapBase = g_meta.heap_extents.base;
    g.heapSize = g_meta.heap_extents.size;
    return true;
}

bool readVec3(u64 address, Vec3& out) {
    if (R_FAILED(dmntchtReadCheatProcessMemory(address, &out, sizeof(out))))
        return false;
    return plausible(out);
}

bool readProfileFile(Profile& profile) {
    FILE* file = std::fopen(profilePath(), "rb");
    if (!file)
        return false;

    unsigned long long offset = 0;
    float x = 0.0f, y = 0.0f, z = 0.0f;
    int score = 0;
    const int count = std::fscanf(file, "%llx %f %f %f %d", &offset, &x, &y, &z, &score);
    std::fclose(file);

    if (count != 5)
        return false;
    if (offset >= g.heapSize)
        return false;
    if (!plausible({x, y, z}))
        return false;

    profile = Profile{true, static_cast<u64>(offset), {x, y, z}, score};
    return true;
}

void scanChunk() {
    if (g.cursor >= g.heapSize) {
        g.stage = ScanStage::WaitMove;
        g.message = "Scan complete. Walk with Link, then press X.";
        g.candidates = g.snapshot.size();
        return;
    }

    const u64 remaining = g.heapSize - g.cursor;
    const std::size_t bytes = static_cast<std::size_t>(std::min<u64>(SCAN_CHUNK, remaining));
    if (bytes < sizeof(Vec3)) {
        g.cursor = g.heapSize;
        return;
    }

    static std::vector<u8> buffer;
    buffer.resize(bytes);
    if (R_FAILED(dmntchtReadCheatProcessMemory(g.heapBase + g.cursor, buffer.data(), bytes))) {
        g.cursor += bytes;
        g.scanned += bytes;
        return;
    }

    for (std::size_t i = 0; i + sizeof(Vec3) <= bytes && g.snapshot.size() < MAX_CANDIDATES; i += 4) {
        Vec3 value{};
        std::memcpy(&value.x, buffer.data() + i, sizeof(float));
        std::memcpy(&value.y, buffer.data() + i + 4, sizeof(float));
        std::memcpy(&value.z, buffer.data() + i + 8, sizeof(float));

        if (!plausible(value))
            continue;

        Candidate candidate{};
        candidate.address = g.heapBase + g.cursor + i;
        candidate.heapOffset = g.cursor + i;
        candidate.value = value;
        candidate.score = 1;
        g.snapshot.push_back(candidate);
    }

    g.cursor += bytes;
    g.scanned += bytes;

    if (g.cursor >= g.heapSize) {
        g.stage = ScanStage::WaitMove;
        g.candidates = g.snapshot.size();
        g.message = "Scan complete. Walk with Link, then press X.";
    } else {
        g.message = "Scanning game memory…";
    }
}

void filterCandidates(bool verticalPhase) {
    if (g.moving.empty())
        return;

    std::vector<Candidate> filtered;
    filtered.reserve(g.moving.size());

    for (const Candidate& candidate : g.moving) {
        Vec3 current{};
        if (!readVec3(candidate.address, current))
            continue;

        const float dx = current.x - candidate.value.x;
        const float dy = current.y - candidate.value.y;
        const float dz = current.z - candidate.value.z;

        Candidate updated = candidate;
        updated.value = current;

        if (!verticalPhase) {
            if (std::sqrt(dx * dx + dz * dz) < MOVE_EPS)
                continue;
            updated.score += 2;
        } else {
            if (std::fabs(dy) < JUMP_EPS)
                continue;
            updated.score += 4;
        }

        filtered.push_back(updated);
    }

    g.moving.swap(filtered);
    g.candidates = g.moving.size();
}

void selectBest() {
    if (g.moving.empty()) {
        fail("No stable coordinate candidate. Run Auto Discovery again.");
        return;
    }

    const auto best = std::max_element(
        g.moving.begin(), g.moving.end(),
        [](const Candidate& a, const Candidate& b) {
            return a.score < b.score;
        });

    g.profile = Profile{true, best->heapOffset, best->value, best->score};
    g.player = best->value;
    g.playerValid = true;
    saveProfile();
    g.stage = ScanStage::Ready;
    g.message = "Coordinate profile found and saved.";
}

} // namespace

State& state() {
    return g;
}

Result initMemory() {
    if (g_dmntInitialized)
        return 0;

    Result rc = dmntchtInitialize();
    if (R_FAILED(rc)) {
        fail("dmnt:cht is unavailable.");
        return rc;
    }

    g_dmntInitialized = true;
    g.dmntReady = true;

    bool hasProcess = false;
    if (R_SUCCEEDED(dmntchtHasCheatProcess(&hasProcess)) && !hasProcess) {
        rc = dmntchtForceOpenCheatProcess();
        if (R_FAILED(rc)) {
            fail("Could not open TOTK debug process.");
            return rc;
        }
        g.attachedByUs = true;
    }

    if (!findTargetProcess()) {
        if (g.attachedByUs) {
            dmntchtForceCloseCheatProcess();
            g.attachedByUs = false;
        }
        fail("TOTK 1.4.3 process not detected.");
        return 1;
    }

    loadProfile();
    if (g.profile.valid)
        refreshPlayer();

    if (g.playerValid) {
        g.stage = ScanStage::Ready;
        g.message = "Saved coordinate profile loaded.";
    }

    return 0;
}

void shutdownMemory() {
    if (g.attachedByUs) {
        // Only close a process we opened ourselves. If another tool owns the
        // cheat process, leave it alone.
        dmntchtForceCloseCheatProcess();
        g.attachedByUs = false;
    }

    if (g_dmntInitialized) {
        dmntchtExit();
        g_dmntInitialized = false;
    }

    g.dmntReady = false;
}

void startAutoScan() {
    if (!g.dmntReady && R_FAILED(initMemory()))
        return;

    g.snapshot.clear();
    g.moving.clear();
    g.candidates = 0;
    g.cursor = 0;
    g.scanned = 0;
    g.profile.valid = false;
    g.playerValid = false;
    g.error.clear();
    g.stage = ScanStage::Scanning;
    g.message = "Scanning game memory…";
}

void captureMove() {
    if (g.stage != ScanStage::WaitMove)
        return;

    g.moving = g.snapshot;
    filterCandidates(false);

    if (g.moving.empty()) {
        fail("No moving candidates. Restart Auto Discovery and walk farther.");
        return;
    }

    g.stage = ScanStage::WaitJump;
    g.message = "Now jump or change elevation, then press X.";
}

void captureJump() {
    if (g.stage != ScanStage::WaitJump)
        return;

    filterCandidates(true);
    selectBest();
}

void resetScan() {
    g.stage = ScanStage::Idle;
    g.message = "Ready";
    g.error.clear();
    g.snapshot.clear();
    g.moving.clear();
    g.candidates = 0;
    g.cursor = 0;
    g.scanned = 0;
    g.playerValid = false;
}

void refreshPlayer() {
    if (!g.profile.valid || g.heapBase == 0 || g.profile.offset >= g.heapSize) {
        g.playerValid = false;
        return;
    }

    Vec3 value{};
    if (!readVec3(g.heapBase + g.profile.offset, value)) {
        g.playerValid = false;
        return;
    }

    g.player = value;
    g.playerValid = true;
}

void tick() {
    if (!g.dmntReady)
        return;

    if (g.stage == ScanStage::Scanning) {
        scanChunk();
    } else if (g.stage == ScanStage::Ready) {
        refreshPlayer();
    }
}

void saveProfile() {
    if (!g.profile.valid)
        return;

    // The installer creates /switch/totk_explorer and places points.csv there.
    // Keep profile persistence read/write-only so the overlay never needs mkdir.
    FILE* file = std::fopen(profilePath(), "wb");
    if (!file)
        return;

    std::fprintf(
        file,
        "%llx %.7g %.7g %.7g %d\n",
        static_cast<unsigned long long>(g.profile.offset),
        static_cast<double>(g.profile.value.x),
        static_cast<double>(g.profile.value.y),
        static_cast<double>(g.profile.value.z),
        g.profile.score);

    std::fclose(file);
}

void loadProfile() {
    Profile profile{};
    if (readProfileFile(profile))
        g.profile = profile;
}

const char* stageText(ScanStage stage) {
    switch (stage) {
        case ScanStage::Idle: return "Ready";
        case ScanStage::Scanning: return "Scanning";
        case ScanStage::WaitMove: return "Move Link / press X";
        case ScanStage::WaitJump: return "Jump / press X";
        case ScanStage::Ready: return "Ready";
        case ScanStage::Failed: return "Failed";
        default: return "Unknown";
    }
}

std::string regionName(const Vec3& p) {
    if (p.y > 500.0f) return "Sky";
    if (p.y < -100.0f) return "Depths";
    return "Hyrule";
}

std::string layerName(const Vec3& p) {
    if (p.y > 500.0f) return "Sky";
    if (p.y < -100.0f) return "Depths";
    return "Surface";
}

} // namespace ex
