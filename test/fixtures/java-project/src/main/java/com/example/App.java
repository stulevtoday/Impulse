package com.example;

import com.example.service.UserService;

public class App {
    public static void main(String[] args) {
        UserService service = new UserService();
        service.createUser("Pulse");
    }
}
