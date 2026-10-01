#include "explorer.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>

namespace ex {

void loadPoints() {
    state().points.clear();

    FILE* file = std::fopen("sdmc:/switch/totk_explorer/points.csv", "rb");
    if (!file)
        return;

    char line[512]{};
    while (std::fgets(line, sizeof(line), file)) {
        if (line[0] == '#' || line[0] == '\n' || line[0] == '\r')
            continue;

        char type[64]{};
        char name[192]{};
        float x = 0.0f, y = 0.0f, z = 0.0f;

        if (std::sscanf(line, "%63[^,],%191[^,],%f,%f,%f", type, name, &x, &y, &z) == 5) {
            state().points.push_back(Point{type, name, x, y, z});
        }
    }

    std::fclose(file);
}

std::vector<Point> nearby(float radius, std::size_t maxCount) {
    std::vector<Point> result;
    if (!state().playerValid)
        return result;

    struct DistancePoint {
        float distance;
        Point point;
    };

    std::vector<DistancePoint> distances;
    distances.reserve(state().points.size());

    const float radiusSquared = radius * radius;

    for (const auto& point : state().points) {
        const float dx = point.x - state().player.x;
        const float dy = point.y - state().player.y;
        const float dz = point.z - state().player.z;
        const float d2 = dx * dx + dz * dz + 0.25f * dy * dy;

        if (d2 <= radiusSquared)
            distances.push_back({std::sqrt(d2), point});
    }

    std::sort(distances.begin(), distances.end(), [](const DistancePoint& a, const DistancePoint& b) {
        return a.distance < b.distance;
    });

    for (std::size_t i = 0; i < distances.size() && i < maxCount; ++i)
        result.push_back(distances[i].point);

    return result;
}

} // namespace ex
