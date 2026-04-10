<?php
namespace App\Http\Controllers;

use App\Services\UserService;
use App\Models\User;

class UserController
{
    private UserService $service;

    public function __construct(UserService $service)
    {
        $this->service = $service;
    }

    public function index(): array
    {
        return $this->service->findAll()->toArray();
    }
}
