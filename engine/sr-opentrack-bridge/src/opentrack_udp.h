// opentrack_udp.h — OpenTrack UDP sender
// Protocol: 48 bytes, 6 doubles (X,Y,Z,Yaw,Pitch,Roll), little-endian, degrees
// Default port 4242, no handshake, fire-and-forget UDP
#pragma once

#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <winsock2.h>
#include <ws2tcpip.h>
#pragma comment(lib, "ws2_32.lib")

#pragma pack(push, 1)
struct TOpenTrack {
    double X;
    double Y;
    double Z;
    double Yaw;
    double Pitch;
    double Roll;
};
#pragma pack(pop)

class OpenTrackSender {
    SOCKET sock_ = INVALID_SOCKET;
    sockaddr_in dest_ = {};
    bool initialized_ = false;
    bool wsa_started_ = false;

public:
    bool init(const char* host = "127.0.0.1", int port = 4242) {
        WSADATA wsa;
        if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) return false;
        wsa_started_ = true;

        sock_ = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
        if (sock_ == INVALID_SOCKET) return false;

        // Non-blocking so send never stalls the main loop
        u_long nonblock = 1;
        ioctlsocket(sock_, FIONBIO, &nonblock);

        dest_.sin_family = AF_INET;
        dest_.sin_port = htons(static_cast<u_short>(port));
        inet_pton(AF_INET, host, &dest_.sin_addr);

        initialized_ = true;
        return true;
    }

    bool send(double x, double y, double z, double yaw, double pitch, double roll) {
        if (!initialized_) return false;
        TOpenTrack pkt = {x, y, z, yaw, pitch, roll};
        int sent = sendto(sock_, reinterpret_cast<const char*>(&pkt), sizeof(pkt), 0,
                          reinterpret_cast<sockaddr*>(&dest_), sizeof(dest_));
        return sent == sizeof(pkt);
    }

    bool send(double yaw, double pitch, double roll) {
        return send(0.0, 0.0, 0.0, yaw, pitch, roll);
    }

    // Send identity rotation (camera returns to center)
    bool sendIdentity() {
        return send(0.0, 0.0, 0.0);
    }

    void shutdown() {
        if (sock_ != INVALID_SOCKET) {
            // Send final identity so VRto3D doesn't freeze at last pose
            sendIdentity();
            closesocket(sock_);
            sock_ = INVALID_SOCKET;
        }
        if (wsa_started_) {
            WSACleanup();
            wsa_started_ = false;
        }
        initialized_ = false;
    }

    bool isInitialized() const { return initialized_; }

    ~OpenTrackSender() { shutdown(); }
};
