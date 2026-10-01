#include <tesla.hpp>
#include <memory>
#include "explorer.hpp"

#include <array>
#include <cmath>
#include <cstdio>
#include <string>

namespace {

std::string f2(float value) {
    char buffer[32]{};
    std::snprintf(buffer, sizeof(buffer), "%.2f", static_cast<double>(value));
    return buffer;
}

std::string distanceText(const ex::Vec3& player, const ex::Point& point) {
    const float dx = point.x - player.x;
    const float dy = point.y - player.y;
    const float dz = point.z - player.z;
    const float distance = std::sqrt(dx * dx + dz * dz + 0.25f * dy * dy);

    char buffer[48]{};
    std::snprintf(buffer, sizeof(buffer), "%.0f m", static_cast<double>(distance));
    return buffer;
}


class ScanGui final : public tsl::Gui {
public:
    tsl::elm::Element* createUI() override {
        auto* frame = new tsl::elm::OverlayFrame("TOTK EXPLORER", "Auto Discovery");
        auto* list = new tsl::elm::List();
        const auto& state = ex::state();

        list->addItem(new tsl::elm::CategoryHeader("Automatic coordinate detection"));
        list->addItem(new tsl::elm::ListItem("Stage", ex::stageText(state.stage)));
        list->addItem(new tsl::elm::ListItem("Status", state.message));

        if (state.heapSize > 0) {
            char progress[32]{};
            const double pct = 100.0 * static_cast<double>(state.scanned) / static_cast<double>(state.heapSize);
            std::snprintf(progress, sizeof(progress), "%.1f%%", pct);
            list->addItem(new tsl::elm::ListItem("Scan progress", progress));
        }

        list->addItem(new tsl::elm::ListItem("Candidates", std::to_string(state.candidates)));

        auto* start = new tsl::elm::ListItem("Start / Restart Scan");
        start->setClickListener([](u64 keys) {
            if (keys & HidNpadButton_A) {
                ex::startAutoScan();
                return true;
            }
            return false;
        });
        list->addItem(start);

        list->addItem(new tsl::elm::CategoryHeader("Calibration"));
        list->addItem(new tsl::elm::ListItem("X", "After walking, capture movement"));
        list->addItem(new tsl::elm::ListItem("X again", "After jumping, capture height"));
        list->addItem(new tsl::elm::ListItem("Y", "Reset scan"));
        list->addItem(new tsl::elm::ListItem("Saved profile", state.profile.valid ? "yes" : "no"));

        if (state.playerValid)
            list->addItem(new tsl::elm::ListItem("X/Y/Z", f2(state.player.x) + " / " + f2(state.player.y) + " / " + f2(state.player.z)));

        frame->setContent(list);
        return frame;
    }

    void update() override {
        ex::tick();
    }

    bool handleInput(u64 keysDown, u64, const HidTouchState&, HidAnalogStickState, HidAnalogStickState) override {
        if (keysDown & HidNpadButton_X) {
            if (ex::state().stage == ex::ScanStage::WaitMove)
                ex::captureMove();
            else if (ex::state().stage == ex::ScanStage::WaitJump)
                ex::captureJump();
            return true;
        }

        if (keysDown & HidNpadButton_Y) {
            ex::resetScan();
            return true;
        }

        if (keysDown & HidNpadButton_B) {
            tsl::goBack();
            return true;
        }

        return false;
    }
};

class MapGui final : public tsl::Gui {
public:
    tsl::elm::Element* createUI() override {
        auto* frame = new tsl::elm::OverlayFrame("TOTK EXPLORER", "Dynamic Map");
        auto* list = new tsl::elm::List();
        const auto& state = ex::state();

        list->addItem(new tsl::elm::CategoryHeader("Live local map"));

        if (!state.playerValid) {
            list->addItem(new tsl::elm::ListItem("Player", "Run Auto Discovery first"));
            frame->setContent(list);
            return frame;
        }

        list->addItem(new tsl::elm::ListItem("Layer", ex::layerName(state.player)));
        list->addItem(new tsl::elm::ListItem("Position", f2(state.player.x) + ", " + f2(state.player.y) + ", " + f2(state.player.z)));

        constexpr int GRID = 9;
        constexpr float CELL_SIZE = 250.0f;
        std::array<std::string, GRID> rows{};
        for (auto& row : rows)
            row = std::string(GRID, '.');
        rows[GRID / 2][GRID / 2] = '@';

        for (const auto& point : state.points) {
            const float dx = point.x - state.player.x;
            const float dz = point.z - state.player.z;
            const int gx = static_cast<int>(std::lround(dx / CELL_SIZE)) + GRID / 2;
            const int gy = static_cast<int>(std::lround(dz / CELL_SIZE)) + GRID / 2;
            if (gx < 0 || gx >= GRID || gy < 0 || gy >= GRID)
                continue;

            char marker = '*';
            if (point.type == "Shrine") marker = 'S';
            else if (point.type == "Korok") marker = 'K';
            else if (point.type == "Lightroot") marker = 'L';
            else if (point.type == "Tower") marker = 'T';
            else if (point.type == "Cave") marker = 'C';
            else if (point.type == "Chasm") marker = 'H';

            rows[gy][gx] = marker;
        }

        list->addItem(new tsl::elm::CategoryHeader("N ↑  @ Link  S Shrine  K Korok  L Lightroot  T Tower  C Cave  H Chasm"));
        for (auto it = rows.rbegin(); it != rows.rend(); ++it)
            list->addItem(new tsl::elm::ListItem(*it));

        list->addItem(new tsl::elm::CategoryHeader("Nearby"));
        const auto points = ex::nearby(1000.0f, 8);
        for (const auto& point : points)
            list->addItem(new tsl::elm::ListItem(point.type + " · " + point.name, distanceText(state.player, point)));

        if (points.empty())
            list->addItem(new tsl::elm::ListItem("No nearby points", "Add entries to points.csv"));

        frame->setContent(list);
        return frame;
    }

    void update() override {
        ex::tick();
    }

    bool handleInput(u64 keysDown, u64, const HidTouchState&, HidAnalogStickState, HidAnalogStickState) override {
        if (keysDown & HidNpadButton_B) {
            tsl::goBack();
            return true;
        }
        return false;
    }
};

class NearbyGui final : public tsl::Gui {
public:
    tsl::elm::Element* createUI() override {
        auto* frame = new tsl::elm::OverlayFrame("TOTK EXPLORER", "Nearby");
        auto* list = new tsl::elm::List();
        const auto& state = ex::state();

        if (!state.playerValid) {
            list->addItem(new tsl::elm::ListItem("Status", "Run Auto Discovery first"));
            frame->setContent(list);
            return frame;
        }

        const auto points = ex::nearby(2000.0f, 20);
        for (const auto& point : points)
            list->addItem(new tsl::elm::ListItem(point.type + " · " + point.name, distanceText(state.player, point)));

        if (points.empty())
            list->addItem(new tsl::elm::ListItem("No nearby points", "Add entries to points.csv"));

        frame->setContent(list);
        return frame;
    }

    void update() override {
        ex::tick();
    }

    bool handleInput(u64 keysDown, u64, const HidTouchState&, HidAnalogStickState, HidAnalogStickState) override {
        if (keysDown & HidNpadButton_B) {
            tsl::goBack();
            return true;
        }
        return false;
    }
};

class InfoGui final : public tsl::Gui {
public:
    tsl::elm::Element* createUI() override {
        auto* frame = new tsl::elm::OverlayFrame("TOTK EXPLORER", "Diagnostics");
        auto* list = new tsl::elm::List();
        const auto& state = ex::state();

        list->addItem(new tsl::elm::CategoryHeader("Target"));
        list->addItem(new tsl::elm::ListItem("Title ID", ex::TITLE_TEXT));
        list->addItem(new tsl::elm::ListItem("Version", ex::GAME_VERSION));
        list->addItem(new tsl::elm::ListItem("Build ID", ex::BID_TEXT));

        list->addItem(new tsl::elm::CategoryHeader("Runtime"));
        list->addItem(new tsl::elm::ListItem("dmnt:cht", state.dmntReady ? "yes" : "no"));
        list->addItem(new tsl::elm::ListItem("PID", std::to_string(state.processId)));
        list->addItem(new tsl::elm::ListItem("Heap", std::to_string(static_cast<unsigned long long>(state.heapSize))));
        list->addItem(new tsl::elm::ListItem("Map points", std::to_string(state.points.size())));

        if (state.playerValid) {
            list->addItem(new tsl::elm::ListItem("Region", ex::regionName(state.player)));
            list->addItem(new tsl::elm::ListItem("Layer", ex::layerName(state.player)));
        }

        list->addItem(new tsl::elm::CategoryHeader("Save / progress"));
        list->addItem(new tsl::elm::ListItem("Progress flags", "Not enabled"));
        list->addItem(new tsl::elm::ListItem("Memory writes", "Disabled"));

        frame->setContent(list);
        return frame;
    }

    bool handleInput(u64 keysDown, u64, const HidTouchState&, HidAnalogStickState, HidAnalogStickState) override {
        if (keysDown & HidNpadButton_B) {
            tsl::goBack();
            return true;
        }
        return false;
    }
};

} // namespace

class MainGui final : public tsl::Gui {
public:
    tsl::elm::Element* createUI() override {
        auto* frame = new tsl::elm::OverlayFrame("TOTK EXPLORER", ex::VERSION);
        auto* list = new tsl::elm::List();
        const auto& state = ex::state();

        list->addItem(new tsl::elm::CategoryHeader("Tears of the Kingdom 1.4.3"));
        list->addItem(new tsl::elm::ListItem("BID", ex::BID_TEXT));
        list->addItem(new tsl::elm::ListItem("Memory", state.dmntReady ? "dmnt:cht connected" : "not connected"));
        list->addItem(new tsl::elm::ListItem("Coordinates", state.playerValid ? "Live" : "Not discovered"));

        auto* scan = new tsl::elm::ListItem("Auto Discovery");
        scan->setClickListener([](u64 keys) {
            if (keys & HidNpadButton_A) {
                tsl::changeTo<ScanGui>();
                return true;
            }
            return false;
        });
        list->addItem(scan);

        auto* map = new tsl::elm::ListItem("Dynamic Map");
        map->setClickListener([](u64 keys) {
            if (keys & HidNpadButton_A) {
                tsl::changeTo<MapGui>();
                return true;
            }
            return false;
        });
        list->addItem(map);

        auto* nearby = new tsl::elm::ListItem("Nearby Objects");
        nearby->setClickListener([](u64 keys) {
            if (keys & HidNpadButton_A) {
                tsl::changeTo<NearbyGui>();
                return true;
            }
            return false;
        });
        list->addItem(nearby);

        auto* info = new tsl::elm::ListItem("Build / Diagnostics");
        info->setClickListener([](u64 keys) {
            if (keys & HidNpadButton_A) {
                tsl::changeTo<InfoGui>();
                return true;
            }
            return false;
        });
        list->addItem(info);

        frame->setContent(list);
        return frame;
    }

    void update() override {
        ex::tick();
    }

    bool handleInput(u64 keysDown, u64, const HidTouchState&, HidAnalogStickState, HidAnalogStickState) override {
        if (keysDown & HidNpadButton_B) {
            tsl::Overlay::get()->close();
            return true;
        }
        return false;
    }
};


std::unique_ptr<tsl::Gui> createMainGui() {
    return std::make_unique<MainGui>();
}
