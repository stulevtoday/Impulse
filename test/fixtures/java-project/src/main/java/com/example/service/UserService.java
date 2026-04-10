package com.example.service;

import com.example.model.User;
import com.example.repository.UserRepository;
import java.util.List;

public class UserService {
    private final UserRepository repo = new UserRepository();

    public User createUser(String name) {
        return repo.save(new User(name));
    }

    public List<User> findAll() {
        return repo.findAll();
    }
}
