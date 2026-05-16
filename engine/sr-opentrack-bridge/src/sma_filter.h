// sma_filter.h — Simple Moving Average filter (MIT License)
#pragma once
#include <deque>
#include <cstddef>

class SMAFilter {
    std::deque<float> window_;
    size_t window_size_;
    float sum_ = 0.0f;
public:
    explicit SMAFilter(size_t window_size = 5) : window_size_(window_size) {}
    void reset() { window_.clear(); sum_ = 0.0f; }
    float filter(float value) {
        window_.push_back(value);
        sum_ += value;
        if (window_.size() > window_size_) {
            sum_ -= window_.front();
            window_.pop_front();
        }
        return sum_ / window_.size();
    }
};
