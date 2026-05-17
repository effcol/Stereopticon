#pragma once

#ifndef DIRECTINPUT_H_INCLUDED
#define DIRECTINPUT_H_INCLUDED

#define DIRECTINPUT_VERSION 0x0800
#include <dinput.h>

class DirectInput
{
public: 	
	bool active;	
	bool Init(HINSTANCE hinst, HWND hwnd);		
	bool IsDown(int button);
	bool IsUp(int button);
	void GetCoords(int* x, int* y);
	int GetWheel();
	void Activate();
	void Deactivate();
	void Shutdown();
private:
	int ReadMouse();	
	LPDIRECTINPUT8 lpdi;
	LPDIRECTINPUTDEVICE8 lpdimouse;
	DIMOUSESTATE2 mousestate;
};
#endif