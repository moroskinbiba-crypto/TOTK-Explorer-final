#define TESLA_INIT_IMPL
#include <tesla.hpp>
#include "explorer.hpp"

#include <memory>

class TotkExplorerOverlay final : public tsl::Overlay {
public:
    void initServices() override {
        ex::loadPoints();
        (void)ex::initMemory();
    }

    void exitServices() override {
        ex::shutdownMemory();
    }

    std::unique_ptr<tsl::Gui> loadInitialGui() override;
};

// MainGui is implemented in ui.cpp and is intentionally declared here so that
// the overlay entrypoint remains in one translation unit.
class MainGui;

std::unique_ptr<tsl::Gui> TotkExplorerOverlay::loadInitialGui() {
    // The GUI factory is provided by ui.cpp through this function.
    extern std::unique_ptr<tsl::Gui> createMainGui();
    return createMainGui();
}

int main(int argc, char** argv) {
    return tsl::loop<TotkExplorerOverlay>(argc, argv);
}
