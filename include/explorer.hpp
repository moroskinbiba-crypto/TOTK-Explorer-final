#pragma once

#include <switch.h>
#include <cstdint>
#include <string>
#include <vector>

namespace ex {

inline constexpr u64 TITLE_ID = 0x0100F2C0115B6000ULL;
inline constexpr const char* TITLE_TEXT = "0100F2C0115B6000";
inline constexpr const char* BID_TEXT = "277178B7DBA1B6D4";
inline constexpr const char* GAME_VERSION = "1.4.3";
inline constexpr const char* VERSION = "3.0.1";

struct Vec3 { float x{}, y{}, z{}; };
struct Point { std::string type, name; float x{}, y{}, z{}; };
struct Candidate { u64 address{}, heapOffset{}; Vec3 value{}; int score{}; };
struct Profile { bool valid{}; u64 offset{}; Vec3 value{}; int score{}; };

enum class ScanStage { Idle, Scanning, WaitMove, WaitJump, Ready, Failed };

struct State {
    ScanStage stage{ScanStage::Idle};
    std::string message{"Ready"};
    std::string error{};
    u64 processId{};
    u64 heapBase{};
    u64 heapSize{};
    u64 cursor{};
    u64 scanned{};
    std::size_t candidates{};
    Vec3 player{};
    bool playerValid{};
    bool dmntReady{};
    bool attachedByUs{};
    Profile profile{};
    std::vector<Candidate> snapshot;
    std::vector<Candidate> moving;
    std::vector<Point> points;
};

State& state();
Result initMemory();
void shutdownMemory();
void tick();
void startAutoScan();
void captureMove();
void captureJump();
void resetScan();
void refreshPlayer();
void loadPoints();
void saveProfile();
void loadProfile();
const char* stageText(ScanStage stage);
std::string regionName(const Vec3& p);
std::string layerName(const Vec3& p);
std::vector<Point> nearby(float radius, std::size_t maxCount);

} // namespace ex
